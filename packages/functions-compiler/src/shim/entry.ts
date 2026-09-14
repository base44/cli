// Injected as `globalThis.Deno` ahead of user code. `serve` is overridden
// because the shim's own would start a real node:http server.

import { AsyncLocalStorage } from "node:async_hooks";

import { Deno as ShimDeno } from "@deno/shim-deno";
import { Buffer } from "node:buffer";

import { installStaticEgressFetch } from "../static-egress";

export { installStaticEgressFetch };

type DenoServeHandler = (
  request: Request,
  info: unknown,
) => Response | Promise<Response>;

// Worker-per-app runs each function's init inside its own `initContext`, so
// Deno.serve writes into that context — never a shared slot a concurrent peer's
// init could clobber. The single-function path (/v1/bundle) has no context, so
// it falls back to `registeredHandler`.
interface InitContext {
  handler: DenoServeHandler | null;
}
let registeredHandler: DenoServeHandler | null = null;
const initContext = new AsyncLocalStorage<InitContext>();

function serve(arg1: unknown, arg2?: unknown) {
  // Deno.serve overloads: (handler) | (options, handler) | ({ ...options, handler }).
  let handler: DenoServeHandler | null = null;
  if (typeof arg1 === "function") {
    handler = arg1 as DenoServeHandler;
  } else if (typeof arg2 === "function") {
    handler = arg2 as DenoServeHandler;
  } else if (arg1 && typeof (arg1 as { handler?: unknown }).handler === "function") {
    handler = (arg1 as { handler: DenoServeHandler }).handler;
  }

  if (!handler) {
    throw new TypeError("Deno.serve: a request handler function is required");
  }

  const ctx = initContext.getStore();
  if (ctx) {
    ctx.handler = handler;
  } else {
    registeredHandler = handler;
  }

  // A Worker has nothing to listen on; return an HttpServer-shaped stub.
  return {
    finished: Promise.resolve(),
    shutdown: async () => {},
    ref() {},
    unref() {},
    addr: { transport: "tcp", hostname: "0.0.0.0", port: 0 },
  };
}

const deno = Object.freeze({
  ...(ShimDeno as unknown as Record<string, unknown>),
  serve,
});

(globalThis as unknown as { Deno: unknown }).Deno = deno;
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

export function getRegisteredHandler(): DenoServeHandler | null {
  return registeredHandler;
}

// ── Worker-per-app: lazy per-function init ──────────────────────────────────
//
// Each function registers an importer thunk instead of running its module at
// Worker startup. A function whose top-level throws, hangs, or rejects then
// affects only its OWN requests — the Worker still starts and peers serve.
// The module runs on first invocation of that function.

type ImportThunk = () => Promise<unknown>;

const lazyImporters = new Map<string, ImportThunk>();
const handlerByName = new Map<string, Promise<DenoServeHandler | null>>();

export function registerLazy(
  functionName: string,
  importThunk: ImportThunk,
): void {
  lazyImporters.set(functionName, importThunk);
}

// `undefined` → no such function in this app. Otherwise a promise for the
// function's handler (`null` → it neither registered a Deno.serve() handler
// nor default-exported one), which rejects if the function's module throws
// while initializing. Each init runs in its own context with no cross-function
// ordering, so one function hanging during init can't stall another's first
// request.
export function resolveHandler(
  functionName: string,
): Promise<DenoServeHandler | null> | undefined {
  const importThunk = lazyImporters.get(functionName);
  if (importThunk === undefined) return undefined;

  let handler = handlerByName.get(functionName);
  if (handler === undefined) {
    const ctx: InitContext = { handler: null };
    handler = initContext.run(ctx, async () => {
      const mod = await importThunk();
      // Deno.serve capture wins (legacy contract, zero behavior change);
      // a default-exported handler is the new-contract fallback.
      if (ctx.handler) return ctx.handler;
      const def = (mod as { default?: unknown } | null)?.default;
      return typeof def === "function" ? (def as DenoServeHandler) : null;
    });
    handlerByName.set(functionName, handler);
  }
  return handler;
}
