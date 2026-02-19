import type { Server } from "node:http";
import { log as clackLog } from "@clack/prompts";
import cors from "cors";
import express from "express";
import getPort from "get-port";
import { createProxyMiddleware } from "http-proxy-middleware";
import { createDevLogger } from "@/cli/dev/createDevLogger.js";
import { FunctionManager } from "@/cli/dev/dev-server/function-manager.js";
import { createFunctionRouter } from "@/cli/dev/dev-server/routes/functions.js";
import type { BackendFunction } from "@/core/resources/function/schema.js";

const DEFAULT_PORT = 4400;
const BASE44_APP_URL = "https://base44.app";

interface DevServerOptions {
  port?: number;
  loadResources: () => Promise<{ functions: BackendFunction[] }>;
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

  const { functions } = await options.loadResources();

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

  if (functionManager.getFunctionNames().length > 0) {
    clackLog.info(
      `Loaded functions: ${functionManager.getFunctionNames().join(", ")}`,
    );

    const functionRoutes = createFunctionRouter(functionManager, devLogger);
    app.use("/api/apps/:appId/functions", functionRoutes);
  }

  app.use((req, res, next) => {
    return remoteProxy(req, res, next);
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", (err) => {
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
        const shutdown = () => {
          functionManager.stopAll();
          server.close();
        };
        process.on("SIGINT", shutdown);
        process.on("SIGTERM", shutdown);

        resolve({
          port,
          server,
        });
      }
    });
  });
}
