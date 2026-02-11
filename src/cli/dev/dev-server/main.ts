import type { Server } from "node:http";
import cors from "cors";
import express from "express";
import getPort from "get-port";
import { createProxyMiddleware } from "http-proxy-middleware";

const DEFAULT_PORT = 4400;
const BASE44_APP_URL = "https://base44.app";

interface DevServerOptions {
  port?: number;
}

interface DevServerResult {
  port: number;
  server: Server;
}

export async function createDevServer(
  options: DevServerOptions = {}
): Promise<DevServerResult> {
  const port = options.port ?? (await getPort({ port: DEFAULT_PORT }));

  const app = express();

  const remoteProxy = createProxyMiddleware({
    target: BASE44_APP_URL,
    changeOrigin: true,
  });

  app.use(
    cors({
      origin: /^http:\/\/localhost(:\d+)?$/,
      credentials: true,
    })
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

  app.use((req, res, next) => {
    return remoteProxy(req, res, next);
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", (err) => {
      if (err) {
        if ("code" in err && err.code === "EADDRINUSE") {
          reject(
            new Error(
              `Port ${port} is already in use. Stop the other process and try again.`
            )
          );
        } else {
          reject(err);
        }
      } else {
        resolve({
          port,
          server,
        });
      }
    });
  });
}
