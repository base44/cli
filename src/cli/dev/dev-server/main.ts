import type { Server } from "node:http";
import { dirname, join } from "node:path";
import { log as clackLog } from "@clack/prompts";
import cors from "cors";
import express from "express";
import getPort from "get-port";
import { createProxyMiddleware } from "http-proxy-middleware";
import { dir } from "tmp-promise";
import { createDevLogger } from "@/cli/dev/createDevLogger.js";
import { FunctionManager } from "@/cli/dev/dev-server/function-manager.js";
import { createFunctionRouter } from "@/cli/dev/dev-server/routes/functions.js";
import type { ProjectData } from "@/core/project/types.js";
import { Database } from "./database.js";
import {
  type BroadcastEntityEvent,
  broadcastEntityEvent,
  createRealtimeServer,
} from "./realtime.js";
import { createEntityRoutes } from "./routes/entities.js";
import {
  createCustomIntegrationRoutes,
  createIntegrationRoutes,
} from "./routes/integrations.js";
import { WatchBase44 } from "./watcher.js";

const DEFAULT_PORT = 4400;
const BASE44_APP_URL = "https://base44.app";

interface DevServerOptions {
  port?: number;
  loadResources: () => Promise<{
    functions: ProjectData["functions"];
    entities: ProjectData["entities"];
    project: ProjectData["project"];
  }>;
}

interface DevServerResult {
  port: number;
  server: Server;
}

export async function createDevServer(
  options: DevServerOptions,
): Promise<DevServerResult> {
  const { port: userPort } = options;
  const port = userPort ?? (await getPort({ port: DEFAULT_PORT }));
  const baseUrl = `http://localhost:${port}`;

  const { functions, entities, project } = await options.loadResources();

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

  const devLogger = createDevLogger();

  const functionManager = new FunctionManager(functions, devLogger);
  const functionRoutes = createFunctionRouter(functionManager, devLogger);
  app.use("/api/apps/:appId/functions", functionRoutes);

  if (functionManager.getFunctionNames().length > 0) {
    clackLog.info(
      `Loaded functions: ${functionManager.getFunctionNames().join(", ")}`,
    );
  }

  const db = new Database();
  db.load(entities);
  if (db.getCollectionNames().length > 0) {
    clackLog.info(`Loaded entities: ${db.getCollectionNames().join(", ")}`);
  }

  // Socket.IO is attached after the HTTP server starts; entity routes receive
  // a broadcast callback that becomes a no-op until the server is ready.
  let emitEntityEvent: BroadcastEntityEvent = () => {};
  const entityRoutes = createEntityRoutes(
    db,
    devLogger,
    remoteProxy,
    (...args) => emitEntityEvent(...args),
  );
  app.use("/api/apps/:appId/entities", entityRoutes);

  const { path: mediaFilesDir } = await dir();

  // Serve uploaded files statically
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
    devLogger.warn(
      `"${req.originalUrl}" is not supported in local development, passing call to production`,
    );
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
        functionManager.reload(functions);

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
        db.load(entities);
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

  const shutdown = () => {
    base44ConfigWatcher.close();
    io.close();
    functionManager.stopAll();
    server.close();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { port, server };
}
