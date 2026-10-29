/**
 * Retries the dependency downloads `@deno/loader` makes through the global
 * `fetch`. The loader never retries (its WASM HTTP client: "todo: implement
 * retrying") and drops the failed download's error, so one registry blip deep
 * in a large tree (Stagehand: ~350 downloads) fails the build as "Could not
 * find constraint '<root package>' in the list of packages", or as a missing
 * module when a tarball was lost.
 *
 * Only GETs to the dependency hosts are retried, on a network error, 429 or
 * 5xx; a 404 is a real answer. Every other request — including the host's own
 * API calls — passes straight through.
 */

import {
  type FetchInput,
  isDependencyHost,
  requestUrl,
} from "./fetch-guard.js";
import { logEvent } from "./log.js";

const RETRY_DELAYS_MS = [250, 1000];

let installed = false;

/** Wrap `globalThis.fetch` once, before the first loader is created. */
export function installDependencyFetchRetry(): void {
  if (installed) return;
  installed = true;
  globalThis.fetch = createRetryingFetch(globalThis.fetch.bind(globalThis));
}

export function createRetryingFetch(
  originalFetch: typeof fetch,
  delaysMs: readonly number[] = RETRY_DELAYS_MS,
): typeof fetch {
  return (async (input: FetchInput, init?: RequestInit) => {
    const url = requestUrl(input);
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method.toUpperCase() !== "GET" || !isDependencyHost(url.hostname)) {
      return originalFetch(input, init);
    }

    for (let attempt = 0; ; attempt++) {
      const delay = delaysMs[attempt];
      let response: Response | undefined;
      let error: unknown;
      try {
        response = await originalFetch(input, init);
        if (response.status !== 429 && response.status < 500) return response;
      } catch (err) {
        error = err;
      }
      // The loader swallows this failure, so the log is the only place its
      // real cause shows.
      logEvent(
        delay === undefined ? "error" : "warn",
        "base44.bundler.dependency_fetch_failed",
        {
          url: url.href,
          attempt: attempt + 1,
          http_status: response?.status,
          error: response
            ? undefined
            : String((error as Error)?.cause ?? error),
        },
      );
      if (delay === undefined) {
        if (response) return response;
        throw error;
      }
      await response?.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }) as typeof fetch;
}
