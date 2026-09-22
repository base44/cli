import type { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import type { Request, RequestHandler } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";
import { createServiceAuthorizationHeader } from "@/cli/dev/dev-server/auth/tokens.js";

/**
 * The request headers the SDK's `createClientFromRequest` reads. Any transport
 * that reverse-proxies a visitor request into app-owned code has to present
 * them, or the app's server code cannot build a client at all — and has to drop
 * the visitor's own copies first, since user code initializes its SDK from
 * them and a caller-supplied `Base44-Api-Url` would point that SDK, and the
 * credential travelling with it, at a host the caller chose. Same contract as
 * the platform's published-worker and sandbox-preview proxies.
 */
const PLATFORM_OWNED_SDK_HEADERS = [
  "base44-app-id",
  "base44-api-url",
  "base44-service-authorization",
  "base44-state",
  "base44-functions-version",
  "x-base44-app-url",
  "x-data-env",
];

/**
 * Set on every request we forward. Seeing it come back in means the app dev
 * server bounced the request at us instead of serving it.
 */
const FORWARDED_HEADER = "base44-dev-forwarded";

const PROXY_LOOP_MESSAGE = [
  "The app dev server sent this request back to the Base44 dev server instead of handling it.",
  "Its Vite proxy is forwarding all of /api; only /api/apps belongs to the backend.",
  "Update @base44/vite-plugin, or narrow the proxy in vite.config.js to /api/apps.",
].join(" ");

export interface AppServerTarget {
  appId: string;
  /** Resolves with the app dev server's origin once it announces itself. */
  waitForOrigin: () => Promise<string>;
}

export interface AppServerProxy {
  middleware: RequestHandler;
  upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

/**
 * Fronts the app's own dev server the way the platform fronts a published app:
 * the CLI is the single origin, `/api/apps` is answered locally, and everything
 * else reaches the app's server carrying the SDK header contract.
 */
export function createAppServerProxy(
  target: AppServerTarget,
  logger: DevLogger,
): AppServerProxy {
  // Resolved before any request is handed to the proxy; the placeholder only
  // satisfies the option's type until the dev server announces its port.
  let origin = "http://127.0.0.1:0";

  const proxy = createProxyMiddleware<IncomingMessage, ServerResponse>({
    router: () => origin,
    changeOrigin: true,
    ws: true,
    on: {
      proxyReq: (proxyReq, req) => {
        for (const header of PLATFORM_OWNED_SDK_HEADERS) {
          proxyReq.removeHeader(header);
        }
        proxyReq.setHeader("Base44-App-Id", target.appId);
        proxyReq.setHeader(
          "Base44-Api-Url",
          `${(req as Request).protocol}://${req.headers.host}`,
        );
        // Production injects a service-role token on every request into app
        // code, so `asServiceRole` works server-side for anonymous visitors too.
        proxyReq.setHeader(
          "Base44-Service-Authorization",
          createServiceAuthorizationHeader(),
        );
        proxyReq.setHeader(FORWARDED_HEADER, "1");
      },
      error: (err, _req, res) => {
        logger.error("App dev server proxy error:", err);
        if (res instanceof ServerResponse && !res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Failed to proxy request to the app dev server",
              details: err.message,
            }),
          );
        }
      },
    },
  });

  const resolveOrigin = async (): Promise<void> => {
    origin = await target.waitForOrigin();
  };

  const middleware: RequestHandler = async (req, res, next) => {
    if (req.headers[FORWARDED_HEADER]) {
      logger.error(PROXY_LOOP_MESSAGE);
      res.status(508).json({ error: PROXY_LOOP_MESSAGE });
      return;
    }
    try {
      await resolveOrigin();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(message);
      res.status(502).json({ error: message });
      return;
    }
    await proxy(req, res, next);
  };

  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    resolveOrigin().then(
      () => proxy.upgrade(req, socket as Socket, head),
      (error: unknown) => {
        logger.error(error instanceof Error ? error.message : String(error));
        socket.destroy();
      },
    );
  };

  return { middleware, upgrade };
}
