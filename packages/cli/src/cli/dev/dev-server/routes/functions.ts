import type { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import type { Request, Response } from "express";
import { Router } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";
import { createServiceAuthorizationHeader } from "@/cli/dev/dev-server/auth/tokens.js";
import type { FunctionRuntime } from "@/cli/dev/dev-server/function-runtime.js";

export function createFunctionRouter(
  manager: FunctionRuntime,
  logger: DevLogger,
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
        // In production, Base44 always injects a service role token when forwarding
        // to functions. Replicate that here so asServiceRole works even for
        // unauthenticated callers (e.g. public-facing subscribe forms).
        proxyReq.setHeader(
          "Base44-Service-Authorization",
          createServiceAuthorizationHeader(),
        );
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
