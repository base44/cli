/**
 * Local implementation of the `base44:runtime` module.
 *
 * Deployed backend functions import this module by its bare specifier
 * (`import { secrets } from "base44:runtime"`). No such module exists on a
 * developer machine, so `deno.json` maps the specifier onto this file and
 * `base44 dev` hands that import map to the Deno subprocess.
 *
 * The surface mirrors production; the deliberate differences are called out on
 * each export below.
 */

/**
 * App secrets.
 *
 * Deployed, these are read from the Worker env binding of the current request.
 * Locally they come from the environment `base44 dev` was started with —
 * values stored with `base44 secrets set` are deliberately not fetched, so a
 * production secret is never copied onto a developer machine. Export the
 * variable in your shell to exercise a function that reads it.
 *
 * Returns `undefined` for an unset name rather than throwing, matching the
 * deployed signature. Code that needs a secret should construct inside the
 * handler: at module scope a client built from `undefined` throws during boot,
 * where no try/catch is reached and nothing is logged.
 */
export const secrets: { get(name: string): string | undefined } = {
  get(name: string): string | undefined {
    return Deno.env.get(name);
  },
};

// Holds a strong reference to in-flight work so a floating promise cannot be
// collected before it settles.
const pending = new Set<Promise<unknown>>();

/**
 * Continue work after the response has been sent.
 *
 * Deployed, this rides `ctx.waitUntil` to extend the invocation until the
 * promise settles. Locally the function is a long-lived server process, so
 * there is nothing to hold open; the promise is tracked only so a rejection is
 * reported against the function instead of surfacing as an unhandled
 * rejection. Returns the same promise so it composes, as in production.
 */
export function waitUntil<T>(promise: Promise<T>): Promise<T> {
  const tracked = Promise.resolve(promise)
    .catch((error: unknown) => {
      console.error("[base44:runtime] waitUntil task failed:", error);
    })
    .finally(() => {
      pending.delete(tracked);
    });
  pending.add(tracked);
  return promise;
}
