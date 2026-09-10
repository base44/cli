// Platform module served for `import { ... } from "base44:runtime"`.
//
// The generated Worker entry owns the per-request AsyncLocalStorage store
// (module-scoped there), so this module reaches request state through the
// `globalThis.Base44` bridge the entry prelude installs — same pattern as the
// private-data-sources modules reading their manifest.

interface Base44Bridge {
  waitUntil(promise: Promise<unknown>): void;
  secrets: { get(name: string): string | undefined };
}

function bridge(): Base44Bridge {
  return (globalThis as { Base44?: Base44Bridge }).Base44 as Base44Bridge;
}

/** Extend this invocation until `promise` settles — background work after the
 *  Response returns. Rides ctx.waitUntil; best-effort, not durable. Returns the
 *  same promise so it composes. */
export function waitUntil<T>(promise: Promise<T>): Promise<T> {
  bridge().waitUntil(promise);
  return promise;
}

/** App secrets, read from the Worker env binding of the current request. */
export const secrets: { get(name: string): string | undefined } = {
  get(name: string): string | undefined {
    return bridge().secrets.get(name);
  },
};
