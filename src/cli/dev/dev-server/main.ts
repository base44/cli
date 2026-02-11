import type { Server } from "node:http";
import cors from "cors";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const DEFAULT_PORT = 3000;
const BASE44_APP_URL = "https://base44.app";

interface DevServerResult {
  port: number;
  server: Server;
}

export async function createDevServer(): Promise<DevServerResult> {
  // After creating of the dev server we need to pass url to the base44 createClient() on the client side.
  // It lives in a separate process, so it's a problem to communicate port and align build process when we're not in full control.
  // So for now I will hard code the port.
  const port = DEFAULT_PORT;

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

  // Redirect auth login requests directly to base44.app so the OAuth flow
  // (redirects + session cookies) works correctly. Proxying breaks OAuth
  // because the session cookie ends up on localhost while Google's callback
  // goes to base44.app.
  const AUTH_LOGIN_PATTERN = /^\/api\/apps\/auth(\/\w+)?\/login/;
  app.use((req, res, next) => {
    if (AUTH_LOGIN_PATTERN.test(req.path)) {
      const targetUrl = `${BASE44_APP_URL}${req.originalUrl}`;
      return res.redirect(targetUrl);
    }
    next();
  });

  app.use((req, res, next) => {
    return remoteProxy(req, res, next);
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, "127.0.0.1", () => {
      resolve({
        port,
        server,
      });
    });

    server.on("error", (err) => {
      server.close();
      reject(err);
    });
  });
}
