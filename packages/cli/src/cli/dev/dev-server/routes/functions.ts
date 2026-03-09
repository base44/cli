import type { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import type { Request, Response } from "express";
import { Router } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import type { Logger } from "../../createDevLogger.js";
import type { FunctionManager } from "../function-manager.js";

export function createFunctionRouter(
  manager: FunctionManager,
  logger: Logger,
): Router {
  const router = Router({ mergeParams: true });
  const portsByRequest = new WeakMap<IncomingMessage, number>();

  const proxy = createProxyMiddleware<IncomingMessage, ServerResponse>({
    router: (req) => `http://localhost:${portsByRequest.get(req)}`,
    changeOrigin: true,
    on: {
      proxyReq: (proxyReq, req) => {
        const xAppId = req.headers["x-app-id"];
        if (xAppId) {
          proxyReq.setHeader("Base44-App-Id", xAppId as string);
        }
        proxyReq.setHeader(
          "Base44-Api-Url",
          `${(req as unknown as Request).protocol}://${req.headers.host}`,
        );
      },
      error: (err, _req, res) => {
        logger.error("Function proxy error:", err);
        if (res instanceof ServerResponse && !res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Failed to proxy request to function",
              details: err.message,
            }),
          );
        }
      },
    },
  });

  router.all(
    "/:functionName",
    async (req: Request<{ functionName: string }>, res: Response, next) => {
      const { functionName } = req.params;

      try {
        const port = await manager.ensureRunning(functionName);
        portsByRequest.set(req, port);
        next();
      } catch (error) {
        logger.error("Function error:", error);
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
      }
    },
    proxy,
  );

  return router;
}
