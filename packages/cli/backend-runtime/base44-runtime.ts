/**
 * Local implementation of the `base44:runtime` module.
 *
 * Deployed backend functions import this module by its bare specifier
 * (`import { secrets } from "base44:runtime"`). No such module exists on a
 * developer machine, so `import-map.json` maps the specifier onto this file and
 * `base44 dev` hands that import map to the Deno subprocess.
 *
 * Like the deployed module, this is only a delegator: it holds no state and
 * reads no environment. Everything is served by the `globalThis.Base44` bridge
 * that the host installs before loading the function — `main.ts` locally, the
 * generated Worker entry when deployed. Keeping the two the same shape means a
 * change to what a secret *is* only touches the host, never this file.
 */

/** Contract the host installs on `globalThis.Base44`. */
export interface Base44Bridge {
  waitUntil(promise: Promise<unknown>): void;
  secrets: { get(name: string): string | undefined };
}

function bridge(): Base44Bridge {
  const installed = (globalThis as { Base44?: Base44Bridge }).Base44;
  if (!installed) {
    throw new Error(
      'base44:runtime was imported without a Base44 function host. It is only available inside a backend function — "base44 dev" installs the bridge before loading your code.',
    );
  }
  return installed;
}

/**
 * App secrets.
 *
 * Deployed, these come from the Worker env binding of the current request.
 * Locally the host reads them from the environment `base44 dev` was started
 * with, so a production secret is never copied onto a developer machine —
 * export the variable in your shell to exercise a function that reads it.
 *
 * Returns `undefined` for an unset name rather than throwing, matching the
 * deployed signature. Code needing a secret should construct inside the
 * handler: at module scope a client built from `undefined` throws during boot,
 * where no try/catch is reached and nothing is logged.
 */
export const secrets: { get(name: string): string | undefined } = {
  get(name: string): string | undefined {
    return bridge().secrets.get(name);
  },
};

/**
 * Continue work after the response has been sent.
 *
 * Deployed, this rides `ctx.waitUntil` to extend the invocation until the
 * promise settles. Locally the function is a long-lived server process, so the
 * host has nothing to hold open and only reports rejections. Returns the same
 * promise either way, so it composes.
 */
export function waitUntil<T>(promise: Promise<T>): Promise<T> {
  bridge().waitUntil(promise);
  return promise;
}
