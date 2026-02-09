import type { Server } from "node:http";
import { dirname, join } from "node:path";
import cors from "cors";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { readProjectConfig } from "@/core/project/index.js";
import { entityResource } from "@/core/resources/entity/resource.js";
import { functionResource } from "@/core/resources/function/resource.js";
import type { Logger } from "../createDevLogger.js";
import { Database } from "./database.js";
import { FunctionManager } from "./function-manager.js";
import { createEntityRoutes } from "./routes/entities.js";
import { createFunctionRoutes } from "./routes/functions.js";
import {
  createCustomIntegrationRoutes,
  createIntegrationRoutes,
} from "./routes/integrations.js";

const DEFAULT_PORT = 3000;

export type ProxyMode = "local" | "proxy";

interface DevServerResult {
  port: number;
  server: Server;
  setProxyMode: (mode: ProxyMode) => void;
  getProxyMode: () => ProxyMode;
  cleanup: () => void;
}

export async function createDevServer(
  logger: Logger
): Promise<DevServerResult> {
  // After creating of the dev server we need to pass url to the base44 createClient() on the client side.
  // It lives in a separate process, so it's a problem to communicate port and align build process when we're not in full control.
  // So for now I will hard code the port.
  const port = DEFAULT_PORT;
  const baseUrl = `http://localhost:${port}`;

  const app = express();
  let currentMode: ProxyMode = "proxy";

  const remoteProxy = createProxyMiddleware({
    target: "https://base44.app",
    changeOrigin: true,
  });

  app.use(cors());

  // Redirect auth login requests directly to base44.app so the OAuth flow
  // (redirects + session cookies) works correctly. Proxying breaks OAuth
  // because the session cookie ends up on localhost while Google's callback
  // goes to base44.app.
  const AUTH_LOGIN_PATTERN = /^\/api\/apps\/auth(\/\w+)?\/login/;
  app.use((req, res, next) => {
    if (AUTH_LOGIN_PATTERN.test(req.path)) {
      const targetUrl = `https://base44.app${req.originalUrl}`;
      return res.redirect(targetUrl);
    }
    next();
  });

  // Mode-aware middleware: proxy intercepts before body parsing
  // so the raw request stream is preserved for forwarding.
  app.use((req, res, next) => {
    if (currentMode === "proxy") {
      return remoteProxy(req, res, next);
    }
    next();
  });

  app.use(express.json());

  const { project } = await readProjectConfig();
  const configDir = dirname(project.configPath);

  const [entities, functions] = await Promise.all([
    entityResource.readAll(join(configDir, project.entitiesDir)),
    functionResource.readAll(join(configDir, project.functionsDir)),
  ]);

  const db = new Database(entities);
  logger.log(
    `Initialized database with entities: ${db.getEntityNames().join(", ")}`
  );

  // Initialize function manager
  const functionManager = new FunctionManager(functions, logger);
  logger.log(
    `Loaded functions: ${functions.map((f) => f.name).join(", ") || "(none)"}`
  );

  // Mount entity routes
  const entityRoutes = createEntityRoutes(db, logger);
  app.use("/api/apps/:appId/entities", entityRoutes);

  // Mount function routes
  const functionRoutes = createFunctionRoutes(functionManager, logger);
  app.use("/api/apps/:appId/functions", functionRoutes);

  const mediaFilesDir = join(configDir, "tmp", "files");

  // Serve uploaded files statically
  app.use("/media", express.static(mediaFilesDir));

  // Mount integration routes
  const integrationRoutes = createIntegrationRoutes(
    mediaFilesDir,
    baseUrl,
    logger
  );
  app.use("/api/apps/:appId/integration-endpoints", integrationRoutes);

  const customIntegrationRoutes = createCustomIntegrationRoutes(logger);
  app.use("/api/apps/:appId/integrations/custom", customIntegrationRoutes);

  // Default route
  app.use((_req, res) => {
    res.json({});
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const cleanup = () => {
        logger.log("Shutting server down...");
        functionManager.stopAll();
        server.close();
      };

      const setProxyMode = (mode: ProxyMode) => {
        currentMode = mode;
        logger.warn(
          `Switched to ${mode === "local" ? "local" : "remote"} mode`
        );
      };

      resolve({
        port,
        server,
        setProxyMode,
        cleanup,
        getProxyMode: () => currentMode,
      });
    });

    server.on("error", reject);
  });
}
