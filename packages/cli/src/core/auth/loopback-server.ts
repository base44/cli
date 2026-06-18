import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import getPort from "get-port";
import { ApiError, InternalError } from "@/core/errors.js";

const LOOPBACK_HOST = "127.0.0.1";
const CALLBACK_PATH = "/callback";

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Base44 CLI</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;padding:48px;color:#1f2937}
h1{font-size:20px;margin:0 0 8px}p{color:#6b7280;margin:0}</style></head>
<body><h1>You're signed in.</h1><p>You can close this tab and return to your terminal.</p></body></html>`;

const ERROR_HTML = (msg: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Base44 CLI</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;padding:48px;color:#991b1b}
h1{font-size:20px;margin:0 0 8px}p{color:#6b7280;margin:0}</style></head>
<body><h1>Sign-in failed</h1><p>${msg}</p></body></html>`;

interface LoopbackCallbackResult {
  code: string;
}

interface LoopbackServer {
  port: number;
  redirectUri: string;
  /** Resolves when the OAuth provider redirects to /callback with a valid code. */
  waitForCallback(
    expectedState: string,
    timeoutMs: number,
  ): Promise<LoopbackCallbackResult>;
  close(): void;
}

export async function startLoopbackServer(): Promise<LoopbackServer> {
  const port = await getPort({ host: LOOPBACK_HOST });

  let resolveCallback: ((result: LoopbackCallbackResult) => void) | null = null;
  let rejectCallback: ((err: Error) => void) | null = null;

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}:${port}`);

    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    if (error) {
      const message = errorDescription ?? error;
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(ERROR_HTML(message));
      rejectCallback?.(
        new ApiError(`Authorization failed: ${message}`, { statusCode: 400 }),
      );
      return;
    }

    // We compare against the server's currently-expected state. waitForCallback
    // captures it in a closure; until waitForCallback is called, every callback
    // is rejected as unsolicited.
    if (!code || !state) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(ERROR_HTML("Missing code or state parameter."));
      rejectCallback?.(
        new ApiError("OAuth callback missing code or state", {
          statusCode: 400,
        }),
      );
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SUCCESS_HTML);

    // Defer to waitForCallback to validate state and resolve.
    pendingCallback = { code, state };
    if (resolveCallback) {
      tryDeliverCallback();
    }
  });

  let pendingCallback: { code: string; state: string } | null = null;
  let expectedState: string | null = null;

  function tryDeliverCallback(): void {
    if (!pendingCallback || !expectedState) return;
    const { code, state } = pendingCallback;
    pendingCallback = null;
    if (state !== expectedState) {
      rejectCallback?.(
        new ApiError("OAuth state mismatch — possible CSRF", {
          statusCode: 400,
        }),
      );
      return;
    }
    resolveCallback?.({ code });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, LOOPBACK_HOST, () => {
      server.removeListener("error", reject);
      // Don't keep the event loop alive on our account. Once the login flow's
      // promises settle and the server is closed, the process should exit
      // naturally. Without this, a browser keep-alive connection holds the
      // listening socket open and Node hangs after "Successfully logged in".
      server.unref();
      resolve();
    });
  });

  const actualPort = (server.address() as AddressInfo).port;
  const redirectUri = `http://${LOOPBACK_HOST}:${actualPort}${CALLBACK_PATH}`;

  return {
    port: actualPort,
    redirectUri,
    waitForCallback(state, timeoutMs) {
      expectedState = state;
      return new Promise<LoopbackCallbackResult>((resolve, reject) => {
        resolveCallback = resolve;
        rejectCallback = reject;

        const timer = setTimeout(() => {
          reject(
            new InternalError(
              `Timed out waiting for browser authentication after ${Math.round(
                timeoutMs / 1000,
              )}s`,
            ),
          );
        }, timeoutMs);

        const wrappedResolve = (r: LoopbackCallbackResult) => {
          clearTimeout(timer);
          resolve(r);
        };
        const wrappedReject = (e: Error) => {
          clearTimeout(timer);
          reject(e);
        };
        resolveCallback = wrappedResolve;
        rejectCallback = wrappedReject;

        // A callback may have arrived before waitForCallback was called.
        tryDeliverCallback();
      });
    },
    close() {
      server.close();
      // server.close() only stops accepting new connections; existing
      // keep-alive sockets persist until idle timeout. Force-close them so
      // the process can exit promptly.
      server.closeAllConnections?.();
    },
  };
}
