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

interface Secrets {
  get(name: string): string;
}

/**
 * Secrets configured for the app.
 *
 * In production these come from the app's environment variables. Locally they
 * come from the environment `base44 dev` was started with — values stored with
 * `base44 secrets set` are deliberately not fetched, so a production secret is
 * never copied onto a developer machine. Export the variable in your shell to
 * exercise a function that reads it.
 *
 * Reading an unset secret throws, matching production, where a missing secret
 * read at module scope crashes boot rather than surfacing as a 500.
 */
export const secrets: Secrets = {
  get(name: string): string {
    const value = Deno.env.get(name);
    if (value === undefined) {
      throw new Error(
        `Secret "${name}" is not set. Locally, secrets are read from the environment that \`base44 dev\` was started with, not from \`base44 secrets set\` — export ${name} and restart the dev server.`,
      );
    }
    return value;
  },
};

// Holds a strong reference to in-flight work so a floating promise cannot be
// collected before it settles.
const pending = new Set<Promise<unknown>>();

/**
 * Continue work after the response has been sent.
 *
 * In production this keeps the Worker alive until the promise settles. Locally
 * the function is a long-lived server process, so there is nothing to hold
 * open; the promise is tracked only so a rejection is reported against the
 * function instead of surfacing as an unhandled rejection.
 */
export function waitUntil(promise: Promise<unknown>): void {
  const tracked = Promise.resolve(promise)
    .catch((error: unknown) => {
      console.error("[base44:runtime] waitUntil task failed:", error);
    })
    .finally(() => {
      pending.delete(tracked);
    });
  pending.add(tracked);
}
