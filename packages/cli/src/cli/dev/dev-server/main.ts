import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import type { Server } from "node:http";
import { dirname, join } from "node:path";
import type { Logger } from "@base44-cli/logger";
import cors from "cors";
import express from "express";
import getPort from "get-port";
import { createProxyMiddleware } from "http-proxy-middleware";
import { dir } from "tmp-promise";
import { createDevLogger, type DevLogger } from "@/cli/dev/createDevLogger.js";
import { FunctionManager } from "@/cli/dev/dev-server/function-manager.js";
import { createFunctionRouter } from "@/cli/dev/dev-server/routes/functions.js";
import { formatSeedCounts } from "@/cli/dev/seed-summary.js";
import { theme } from "@/cli/utils/index.js";
import { ConfigInvalidError } from "@/core/errors.js";
import {
  deleteDevInstance,
  getDataDir,
  getMetaJsonPath,
  readDataDirMeta,
  type SeedState,
  writeDataDirMeta,
  writeDevInstance,
} from "@/core/local-state/index.js";
import type { ProjectData } from "@/core/project/types.js";
import {
  type DevResetResult,
  emptySeedSummary,
  readSeedFiles,
  type SeedData,
  type SeedMode,
  type SeedSummary,
} from "@/core/resources/seed/index.js";
import { Database } from "./db/database.js";
import { applySeeds } from "./db/seed.js";
import {
  type BroadcastEntityEvent,
  broadcastEntityEvent,
  createRealtimeServer,
  type EntityEvent,
} from "./realtime.js";
import {
  createAdminRouter,
  DEV_ADMIN_BASE_PATH,
  type DevServerStatus,
} from "./routes/admin-router.js";
import { createAuthRouter } from "./routes/auth-router.js";
import { createEntityRoutes } from "./routes/entities/entities-router.js";
import {
  createCustomIntegrationRoutes,
  createFileToken,
  createIntegrationRoutes,
} from "./routes/integrations.js";
import { ServeRunner } from "./serve-runner.js";
import { WatchBase44 } from "./watcher.js";

const DEFAULT_PORT = 4400;
const BASE44_APP_URL = "https://base44.app";

interface DevServerOptions {
  log: Logger;
  port?: number;
  denoWrapperPath: string;
  appId?: string;
  /**
   * Enable file-backed persistence and the dev.json instance descriptor under
   * `<projectRoot>/.base44`. Requires `appId`. Omit for in-memory mode.
   */
  state?: {
    projectRoot: string;
    /** Delete the local data dir before loading (start clean). */
    fresh?: boolean;
  };
  loadResources: () => Promise<{
    functions: ProjectData["functions"];
    entities: ProjectData["entities"];
    project: ProjectData["project"];
    siteUrl?: string;
  }>;
}

interface PersistenceContext {
  projectRoot: string;
  appId: string;
  dataDir: string;
  /** Seed state carried over from an existing meta.json (null until seeded). */
  seed: SeedState;
  /**
   * True when the data dir has no (valid) meta.json — first boot, after
   * `--fresh`, or corrupt meta. Triggers the auto-seed.
   */
  isNew: boolean;
}

/**
 * Prepare the on-disk data dir: honor `--fresh`, guard against reusing data
 * that belongs to another app, and carry over the recorded seed state.
 */
async function preparePersistence(
  options: DevServerOptions,
  devLogger: ReturnType<typeof createDevLogger>,
): Promise<PersistenceContext | undefined> {
  if (!options.state || !options.appId) {
    return undefined;
  }

  const { projectRoot, fresh } = options.state;
  const appId = options.appId;
  const dataDir = getDataDir(projectRoot);

  if (fresh) {
    await rm(dataDir, { recursive: true, force: true });
    devLogger.log("--fresh: local data cleared");
  }

  const meta = await readDataDirMeta(dataDir);
  if (meta.status === "corrupt") {
    devLogger.warn(
      `Ignoring corrupt ${getMetaJsonPath(dataDir)}; treating local data as new`,
    );
  }
  if (meta.status === "ok" && meta.meta.appId !== appId) {
    throw new ConfigInvalidError(
      `Local dev data in ${dataDir} belongs to app "${meta.meta.appId}", but this project is linked to app "${appId}".`,
      getMetaJsonPath(dataDir),
      {
        hints: [
          {
            message:
              "Run 'base44 dev --fresh' to delete the local data and start clean",
            command: "base44 dev --fresh",
          },
        ],
      },
    );
  }

  return {
    projectRoot,
    appId,
    dataDir,
    seed: meta.status === "ok" ? meta.meta.seed : null,
    isNew: meta.status !== "ok",
  };
}

/**
 * Auto-seed on startup: apply fixtures (replace mode) when the data dir is
 * new, or hint when existing data was seeded from different seed files.
 * Failures are logged and never crash the dev server — it keeps serving with
 * whatever data applied. Returns the seed state to record in meta/dev.json.
 */
async function runStartupSeed(
  db: Database,
  project: ProjectData["project"],
  persistence: PersistenceContext,
  devLogger: DevLogger,
): Promise<SeedState> {
  let seedData: SeedData | null = null;
  try {
    seedData = await readSeedFiles(project);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    devLogger.error(`Failed to read seed files: ${message}`);
    return persistence.seed;
  }
  if (!seedData) {
    return persistence.seed;
  }

  if (!persistence.isNew) {
    if (persistence.seed?.hash !== seedData.hash) {
      devLogger.log("Seed files changed — run `base44 dev seed` to apply");
    }
    return persistence.seed;
  }

  try {
    const summary = await applySeeds(db, seedData, { mode: "replace" });
    devLogger.log(`Seeds applied: ${formatSeedCounts(summary).join("; ")}`);
    for (const warning of summary.warnings) {
      devLogger.warn(warning);
    }
    return { hash: seedData.hash, appliedAt: new Date().toISOString() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    devLogger.error(
      `Seeding failed: ${message}. Continuing with partially seeded data — fix the seed files and run 'base44 dev seed'.`,
    );
    return persistence.seed;
  }
}

interface DevServerResult {
  port: number;
  server: Server;
  isServingFrontend: boolean;
}

export async function createDevServer(
  options: DevServerOptions,
): Promise<DevServerResult> {
  const { port: userPort } = options;
  const port =
    userPort ??
    (await getPort({
      // Ports should be generated randomly during tests.
      // Otherwise, when tests run in parallel, using the default value causes port collisions.
      port: process.env.IS_TEST === "true" ? undefined : DEFAULT_PORT,
    }));
  const baseUrl = `http://localhost:${port}`;

  const { functions, entities, project, siteUrl } =
    await options.loadResources();

  const app = express();

  const remoteProxy = createProxyMiddleware({
    target: BASE44_APP_URL,
    changeOrigin: true,
  });

  app.use(
    cors({
      origin: /^http:\/\/localhost(:\d+)?$/,
      credentials: true,
    }),
  );

  // Redirect OAuth routes to base44.app directly — proxying breaks the
  // redirect flow and session cookies set by the provider.
  const AUTH_ROUTE_PATTERN = /^\/api\/apps\/auth(\/|$)/;
  app.use((req, res, next) => {
    if (AUTH_ROUTE_PATTERN.test(req.path)) {
      const targetUrl = new URL(req.originalUrl, BASE44_APP_URL);
      return res.redirect(targetUrl.toString());
    }
    next();
  });

  const devLogger = createDevLogger("backend", theme.styles.info);

  const functionManager = new FunctionManager(
    functions,
    devLogger,
    options.denoWrapperPath,
  );
  const functionRoutes = createFunctionRouter(functionManager, devLogger);
  app.use("/api/apps/:appId/functions", functionRoutes);

  if (functionManager.getFunctionNames().length > 0) {
    devLogger.log(
      `Loaded functions: ${functionManager.getFunctionNames().join(", ")}`,
    );
  }

  const persistence = await preparePersistence(options, devLogger);

  const db = new Database({ dataDir: persistence?.dataDir });
  await db.load(entities);

  let seedState: SeedState = persistence?.seed ?? null;
  if (persistence) {
    seedState = await runStartupSeed(db, project, persistence, devLogger);
    await writeDataDirMeta(persistence.dataDir, {
      formatVersion: 1,
      appId: persistence.appId,
      seed: seedState,
    });
  }
  if (db.getCollectionNames().length > 0) {
    devLogger.log(`Loaded entities: ${db.getCollectionNames().join(", ")}`);
  }

  // Socket.IO is attached after the HTTP server starts; entity routes receive
  // a broadcast callback that becomes a no-op until the server is ready.
  let emitEntityEvent: BroadcastEntityEvent = () => {};
  const entityRoutes = await createEntityRoutes(db, devLogger, (...args) =>
    emitEntityEvent(...args),
  );
  app.use("/api/apps/:appId/entities", entityRoutes);

  const authRouter = createAuthRouter(db, devLogger);
  app.use("/api/apps/:appId/auth", authRouter);

  const startedAt = new Date().toISOString();
  const adminToken = randomBytes(32).toString("hex");
  let writeInstanceFile: (() => Promise<void>) | undefined;

  if (persistence) {
    const state = persistence;
    writeInstanceFile = () =>
      writeDevInstance(state.projectRoot, {
        appId: state.appId,
        url: baseUrl,
        port,
        pid: process.pid,
        dataDir: state.dataDir,
        adminToken,
        startedAt,
        seed: seedState,
      });

    const updateSeedState = async (next: SeedState) => {
      seedState = next;
      await writeDataDirMeta(state.dataDir, {
        formatVersion: 1,
        appId: state.appId,
        seed: next,
      });
      await writeInstanceFile?.();
    };

    const seedEmit = (entityName: string, event: EntityEvent) =>
      emitEntityEvent(state.appId, entityName, event);

    const runSeed = async (mode: SeedMode): Promise<SeedSummary> => {
      const seedData = await readSeedFiles(project);
      if (!seedData) {
        return emptySeedSummary(mode);
      }
      const summary = await applySeeds(db, seedData, { mode, emit: seedEmit });
      await updateSeedState({
        hash: seedData.hash,
        appliedAt: new Date().toISOString(),
      });
      return summary;
    };

    const runReset = async (): Promise<DevResetResult> => {
      await db.resetData();
      const seedData = await readSeedFiles(project);
      const summary = seedData
        ? await applySeeds(db, seedData, { mode: "replace", emit: seedEmit })
        : null;
      await updateSeedState(
        seedData
          ? { hash: seedData.hash, appliedAt: new Date().toISOString() }
          : null,
      );
      return {
        reset: true,
        seeded: summary?.applied ?? false,
        dataDir: state.dataDir,
        seed: summary,
      };
    };

    const getStatus = async (): Promise<DevServerStatus> => {
      const collections: Record<string, number> = {};
      for (const name of db.getCollectionNames()) {
        collections[name] = (await db.getCollection(name)?.countAsync({})) ?? 0;
      }
      return {
        appId: state.appId,
        port,
        startedAt,
        seed: seedState,
        collections,
      };
    };

    app.use(
      DEV_ADMIN_BASE_PATH,
      createAdminRouter({
        adminToken,
        logger: devLogger,
        getStatus,
        runSeed,
        runReset,
      }),
    );
  }

  const { path: mediaFilesDir } = await dir();

  app.use("/media/private/:fileUri", (req, res, next) => {
    const { fileUri } = req.params;
    const token = req.query.token as string | undefined;
    if (!token) {
      res.status(401).json({ error: "Missing token" });
      return;
    }
    const expectedToken = createFileToken(fileUri);
    if (token !== expectedToken) {
      res.status(400).json({
        error: "InvalidJWT",
        message: "signature verification failed",
        statusCode: "400",
      });
      return;
    }
    next();
  });

  app.use("/media", express.static(mediaFilesDir));

  const integrationRoutes = createIntegrationRoutes(
    mediaFilesDir,
    baseUrl,
    remoteProxy,
    devLogger,
  );
  app.use("/api/apps/:appId/integration-endpoints", integrationRoutes);

  const customIntegrationRoutes = createCustomIntegrationRoutes(
    remoteProxy,
    devLogger,
  );
  app.use("/api/apps/:appId/integrations/custom", customIntegrationRoutes);

  app.use((req, res, next) => {
    if (siteUrl && (req.path === "/login" || req.path.startsWith("/login/"))) {
      const targetUrl = new URL(req.originalUrl, siteUrl);
      devLogger.warn(
        `"${req.originalUrl}" requires hosted login, redirecting to ${targetUrl.toString()}`,
      );
      res.redirect(targetUrl.toString());
      return;
    }
    // `analytics/track/batch` call is very common and makes logs unreadable while not providing informative value for the user
    if (!req.originalUrl.endsWith("analytics/track/batch")) {
      devLogger.warn(
        `"${req.originalUrl}" is not supported in local development, passing call to production`,
      );
    }
    remoteProxy(req, res, next);
  });

  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, "127.0.0.1", (err) => {
      if (err) {
        if ("code" in err && err.code === "EADDRINUSE") {
          reject(
            new Error(
              `Port ${port} is already in use. Stop the other process and try again.`,
            ),
          );
        } else {
          reject(err);
        }
      } else {
        resolve(s);
      }
    });
  });

  const io = createRealtimeServer(server);
  emitEntityEvent = (appId, entityName, event) => {
    broadcastEntityEvent(io, appId, entityName, event);
  };

  await writeInstanceFile?.();

  const base44ConfigWatcher = new WatchBase44(
    {
      functions: join(dirname(project.configPath), project.functionsDir),
      entities: join(dirname(project.configPath), project.entitiesDir),
    },
    devLogger,
  );
  base44ConfigWatcher.on("change", async (name) => {
    try {
      const { functions, entities } = await options.loadResources();

      if (name === "functions") {
        const previousFunctionCount = functionManager.getFunctionNames().length;
        await functionManager.reload(functions);

        const names = functionManager.getFunctionNames();
        if (names.length > 0) {
          devLogger.log(`Reloaded functions: ${names.sort().join(", ")}`);
        } else if (previousFunctionCount > 0) {
          devLogger.log("All functions removed");
        }
      }

      if (name === "entities") {
        db.reloadSchemas(entities);
        devLogger.log("Entities changed, schemas reloaded (data preserved)");
        if (db.getCollectionNames().length > 0) {
          devLogger.log(
            `Loaded entities: ${db.getCollectionNames().join(", ")}`,
          );
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      devLogger.error(errorMessage);
    }
  });
  await base44ConfigWatcher.start();

  // Run the frontend dev server when the project configures a `site.serveCommand`
  // and we have an app id to inject. It runs from the project root.
  const serveCommand = project.site?.serveCommand;
  let serveRunner: ServeRunner | undefined;
  if (options.appId && serveCommand) {
    serveRunner = new ServeRunner({
      command: serveCommand,
      cwd: project.root,
      env: {
        VITE_BASE44_APP_ID: options.appId,
        VITE_BASE44_APP_BASE_URL: baseUrl,
      },
      logger: createDevLogger("frontend", theme.colors.base44Orange),
    });
  }

  const handleShutdownError = (error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    devLogger.error(`Failed to shut down dev server: ${errorMessage}`);
  };

  const closeServerIfRunning = async () => {
    if (!server.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  };

  const runShutdown = async () => {
    if (persistence) {
      await deleteDevInstance(persistence.projectRoot);
    }
    base44ConfigWatcher.close();
    await io.close();
    await functionManager.stopAll();
    await serveRunner?.stop();
    await closeServerIfRunning();
  };

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    shutdownPromise ??= runShutdown().catch(handleShutdownError);
    return shutdownPromise;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // If the frontend dies, tear the whole dev environment down.
  serveRunner?.onExit(() => {
    void shutdown().finally(() => process.exit(1));
  });

  if (serveRunner) {
    devLogger.log(`Backend running on ${baseUrl}`);
    serveRunner.start();
  }

  return { port, server, isServingFrontend: serveRunner !== undefined };
}
