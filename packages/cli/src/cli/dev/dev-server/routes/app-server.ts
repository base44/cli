import type { IncomingMessage } from "node:http";
import { ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import type { RequestHandler } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { type RawData, WebSocket, WebSocketServer } from "ws";
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

/** What a request into app code carries, in place of any copies of its own. */
function sdkHeaders(
  appId: string,
  host: string | undefined,
): Record<string, string> {
  return {
    "Base44-App-Id": appId,
    // The front door is plain HTTP on localhost, so its origin is the host the
    // request reached.
    "Base44-Api-Url": `http://${host}`,
    // Production injects a service-role token on every request into app code,
    // so `asServiceRole` works server-side for anonymous visitors too.
    "Base44-Service-Authorization": createServiceAuthorizationHeader(),
    [FORWARDED_HEADER]: "1",
  };
}

export interface AppServerTarget {
  appId: string;
  /** Resolves with the app dev server's origin once it announces itself. */
  waitForOrigin: () => Promise<string>;
}

interface AppServerProxy {
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
    on: {
      proxyReq: (proxyReq, req) => {
        for (const header of PLATFORM_OWNED_SDK_HEADERS) {
          proxyReq.removeHeader(header);
        }
        for (const [name, value] of Object.entries(
          sdkHeaders(target.appId, req.headers.host),
        )) {
          proxyReq.setHeader(name, value);
        }
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

  // Relayed message by message rather than tunnelled: under Bun, which runs the
  // compiled binary, bytes written to the socket an `upgrade` listener receives
  // never reach the wire. `ws` is the one path Bun maps onto its own websockets.
  const relay = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => [...protocols][0] ?? false,
  });

  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    resolveOrigin().then(
      () =>
        relay.handleUpgrade(req, socket, head, (client) =>
          relayTo(client, req),
        ),
      (error: unknown) => {
        logger.error(error instanceof Error ? error.message : String(error));
        socket.destroy();
      },
    );
  };

  const relayTo = (client: WebSocket, req: IncomingMessage) => {
    const forwarded: Record<string, string> = {};
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const lower = req.rawHeaders[i].toLowerCase();
      // The handshake's own headers are the upstream client's to set.
      if (
        lower === "host" ||
        lower.startsWith("sec-websocket-") ||
        lower === "upgrade" ||
        lower === "connection" ||
        PLATFORM_OWNED_SDK_HEADERS.includes(lower)
      ) {
        continue;
      }
      forwarded[req.rawHeaders[i]] = req.rawHeaders[i + 1];
    }
    const upstream = new WebSocket(
      `${origin.replace(/^http/, "ws")}${req.url}`,
      client.protocol || undefined,
      {
        headers: {
          ...forwarded,
          ...sdkHeaders(target.appId, req.headers.host),
        },
      },
    );

    // The browser may speak before the dev server has answered.
    const pending: Array<{ data: RawData; isBinary: boolean }> = [];
    client.on("message", (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      } else {
        pending.push({ data, isBinary });
      }
    });
    upstream.on("open", () => {
      for (const { data, isBinary } of pending.splice(0)) {
        upstream.send(data, { binary: isBinary });
      }
    });
    upstream.on("message", (data, isBinary) =>
      client.send(data, { binary: isBinary }),
    );
    client.on("close", () => upstream.close());
    upstream.on("close", () => client.close());
    upstream.on("error", (error) => {
      logger.error("App dev server websocket error:", error);
      client.close();
    });
  };

  return { middleware, upgrade };
}
