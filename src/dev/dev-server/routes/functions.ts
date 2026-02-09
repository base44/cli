import type { IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";
import type { Request, Response } from "express";
import { Router } from "express";
import type { Logger } from "@/dev/createDevLogger.js";
import type { FunctionManager } from "../function-manager.js";

export function createFunctionRoutes(
  manager: FunctionManager,
  logger: Logger
): Router {
  const router = Router({ mergeParams: true });

  router.all(
    "/:functionName",
    async (req: Request<{ functionName: string }>, res: Response) => {
      const { functionName } = req.params;

      try {
        const func = manager.getFunction(functionName);
        if (!func) {
          res.status(404).json({
            error: `Function "${functionName}" not found`,
          });
          return;
        }

        const port = await manager.ensureRunning(functionName);

        await proxyRequest(req, res, port, logger);
      } catch (error) {
        logger.error(`Function error:`, error);
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
      }
    }
  );

  return router;
}

/**
 * Proxy an Express request to a Deno function running on the specified port.
 * Forwards headers, body, and method.
 */
function proxyRequest(
  req: Request,
  res: Response,
  port: number,
  logger: Logger
): Promise<void> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | string[] | undefined> = {
      ...req.headers,
    };
    delete headers.host;

    if (headers["x-app-id"]) {
      headers["Base44-App-Id"] = headers["x-app-id"];
    }

    headers["Base44-Api-Url"] = `${req.protocol}://${req.get("host")}`;

    const options = {
      hostname: "localhost",
      port,
      path: req.url,
      method: req.method,
      headers,
    };

    const proxyReq = httpRequest(options, (proxyRes: IncomingMessage) => {
      // Forward status code
      res.status(proxyRes.statusCode || 200);

      // Forward headers
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (value !== undefined) {
          res.setHeader(key, value);
        }
      }

      // Pipe response body
      proxyRes.pipe(res);

      proxyRes.on("end", () => {
        resolve();
      });

      proxyRes.on("error", (error) => {
        reject(error);
      });
    });

    proxyReq.on("error", (error) => {
      logger.error(`Function proxy error:`, error);
      if (!res.headersSent) {
        res.status(502).json({
          error: "Failed to proxy request to function",
          details: error.message,
        });
      }
      resolve(); // Resolve since we've handled the error
    });

    if (req.body && Object.keys(req.body).length > 0) {
      // Body was already parsed by express.json(), so we need to re-serialize
      const bodyString = JSON.stringify(req.body);
      proxyReq.setHeader("Content-Type", "application/json");
      proxyReq.setHeader("Content-Length", Buffer.byteLength(bodyString));
      proxyReq.write(bodyString);
    }

    proxyReq.end();
  });
}
