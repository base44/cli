/**
 * Deno Function Wrapper
 *
 * This script is executed by Deno to run user functions.
 * It patches Deno.serve to inject a dynamic port before importing the user's function.
 *
 * Two handler shapes are supported:
 * - `export default async function (req) { ... }` — the shape the deployed
 *   runtime expects. The wrapper serves it after importing the module.
 * - `Deno.serve(handler)` — the legacy shape. A module that calls Deno.serve
 *   while being imported serves itself and its default export is ignored,
 *   mirroring the deployed bundler's precedence.
 *
 * Environment variables:
 * - FUNCTION_PATH: Absolute path to the user's function entry file
 * - FUNCTION_PORT: Port number for the function to listen on
 * - FUNCTION_NAME: Name of the function (for logging)
 */

// Make this file a module for top-level await support
export {};

import type { Base44Bridge } from "./base44-runtime.ts";

const functionPath = Deno.env.get("FUNCTION_PATH");
const port = parseInt(Deno.env.get("FUNCTION_PORT") || "8000", 10);
const functionName = Deno.env.get("FUNCTION_NAME") || "unknown";

if (!functionPath) {
  console.error("[wrapper] FUNCTION_PATH environment variable is required");
  Deno.exit(1);
}

// Store the original Deno.serve
const originalServe = Deno.serve.bind(Deno);

// Set when the user's module calls Deno.serve while it is being imported.
// Such a module serves itself, so its default export (if any) is ignored.
let servedDuringImport = false;

// Patch Deno.serve to inject our port and add onListen callback.
const patchedServe = (
  optionsOrHandler:
    | Deno.ServeOptions
    | Deno.ServeHandler
    | (Deno.ServeOptions & { handler: Deno.ServeHandler }),
  maybeHandler?: Deno.ServeHandler,
): Deno.HttpServer<Deno.NetAddr> => {
  servedDuringImport = true;

  const onListen = () => {
    // This message is used by FunctionManager to detect when the function is ready
    console.log(`[${functionName}] Listening on http://localhost:${port}`);
  };

  // Handle the different Deno.serve signatures:
  // 1. Deno.serve(handler)
  // 2. Deno.serve(options, handler)
  // 3. Deno.serve({ ...options, handler })
  if (typeof optionsOrHandler === "function") {
    // Signature: Deno.serve(handler)
    return originalServe({ port, onListen }, optionsOrHandler);
  }

  if (maybeHandler) {
    // Signature: Deno.serve(options, handler)
    return originalServe({ ...optionsOrHandler, port, onListen }, maybeHandler);
  }

  // Signature: Deno.serve({ ...options, handler })
  const options = optionsOrHandler as Deno.ServeOptions & {
    handler: Deno.ServeHandler;
  };
  return originalServe({ ...options, port, onListen });
};

// Deno 2.8 exposes `Deno.serve` as a getter-only property, so a plain
// `Deno.serve = ...` assignment throws. Use defineProperty to override it
// (works on both the old writable property and the new accessor).
Object.defineProperty(Deno, "serve", {
  value: patchedServe,
  writable: true,
  configurable: true,
});

// Local stand-in for the bridge the deployed Worker entry installs. It must be
// in place before the function is imported, because module-scope code may read
// a secret. Deployed, secrets come from the request's Worker env binding and
// `waitUntil` rides `ctx.waitUntil`; locally secrets come from this process's
// environment and the server is long-lived, so there is nothing to hold open —
// in-flight work is only tracked so a rejection is reported against the
// function instead of surfacing as an unhandled rejection.
const inFlight = new Set<Promise<unknown>>();

const base44Bridge: Base44Bridge = {
  secrets: {
    get: (name: string) => Deno.env.get(name),
  },
  waitUntil: (promise: Promise<unknown>) => {
    const tracked = Promise.resolve(promise)
      .catch((error: unknown) => {
        console.error(`[${functionName}] waitUntil task failed:`, error);
      })
      .finally(() => {
        inFlight.delete(tracked);
      });
    inFlight.add(tracked);
  },
};

Object.defineProperty(globalThis, "Base44", {
  value: base44Bridge,
  writable: false,
  configurable: true,
});

type FetchHandler = (req: Request) => Response | Promise<Response>;

/**
 * Pull the request handler off the user's module namespace, accepting both
 * `export default async function (req)` and the `export default { fetch }`
 * object form.
 */
const resolveDefaultHandler = (
  module: Record<string, unknown>,
): FetchHandler | null => {
  const exported = module.default;

  if (typeof exported === "function") {
    return exported as FetchHandler;
  }

  if (exported && typeof exported === "object") {
    const { fetch } = exported as { fetch?: unknown };
    if (typeof fetch === "function") {
      return (fetch as FetchHandler).bind(exported);
    }
  }

  return null;
};

console.log(`[${functionName}] Starting function from ${functionPath}`);

// Dynamically import the user's function. A legacy function calls Deno.serve
// during import, which is now patched to use our port.
let functionModule: Record<string, unknown>;
try {
  functionModule = await import(functionPath);
} catch (error) {
  console.error(`[${functionName}] Failed to load function:`, error);
  Deno.exit(1);
}

// Nothing served itself during import, so the module is expected to export a
// handler. Serving it here goes through the same patched Deno.serve, so the
// readiness line still gets printed exactly once.
if (!servedDuringImport) {
  const handler = resolveDefaultHandler(functionModule);

  if (!handler) {
    console.error(
      `[${functionName}] The function must export default a request handler or call Deno.serve()`,
    );
    Deno.exit(1);
  }

  Deno.serve(handler);
}
