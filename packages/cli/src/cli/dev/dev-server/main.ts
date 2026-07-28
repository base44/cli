import type { Server } from "node:http";
import { dirname, join } from "node:path";
import type { Logger } from "@base44-cli/logger";
import cors from "cors";
import express from "express";
import getPort from "get-port";
import { createProxyMiddleware } from "http-proxy-middleware";
import { dir } from "tmp-promise";
import { createDevLogger } from "@/cli/dev/createDevLogger.js";
import { createFunctionRuntime } from "@/cli/dev/dev-server/function-runtime.js";
import { createFunctionRouter } from "@/cli/dev/dev-server/routes/functions.js";
import { theme } from "@/cli/utils/index.js";
import type { ProjectData } from "@/core/project/types.js";
import { Database } from "./db/database.js";
import {
  type BroadcastEntityEvent,
  broadcastEntityEvent,
  createRealtimeServer,
} from "./realtime.js";
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
  loadResources: () => Promise<{
    functions: ProjectData["functions"];
    entities: ProjectData["entities"];
    project: ProjectData["project"];
    siteUrl?: string;
  }>;
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

  const functionManager = await createFunctionRuntime(
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

  const db = new Database();
  await db.load(entities);
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
        const previousEntityCount = db.getCollectionNames().length;
        db.dropAll();
        if (previousEntityCount > 0) {
          devLogger.log("Entities directory changed, clearing data...");
        }
        await db.load(entities);
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
