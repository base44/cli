/**
 * Process-level guard on `globalThis.fetch`. The Deno resolver (`@deno/loader`)
 * routes every dependency download — npm metadata, npm tarballs, jsr, and any
 * `https:` import — through the global `fetch`, so wrapping it is the single
 * enforcement point that replaces the per-filesystem caps the old virtual-FS
 * installer provided:
 *
 *   - Host allowlist: the npm + jsr registries plus the esm.sh and deno.land
 *     CDNs (so `https:` imports from those work). Every other host is blocked,
 *     so user code can't pull from arbitrary origins (the supply-chain vector
 *     the old compat layer rejected by scanning specifiers).
 *   - Per-response byte cap via the `Content-Length` header. The body itself is
 *     never touched: rewrapping the response stream (an earlier TransformStream
 *     approach) corrupts delivery to the loader once a live `node:http` server
 *     is handling requests, so the original `Response` is always returned as-is.
 *     Downloads without a length header rely on the container memory limit, disk
 *     (deps land in DENO_DIR, not the heap), and the per-request deadline.
 *
 * Install once at startup, before the server begins handling requests.
 */

import { logEvent } from "./log.js";

const ALLOWED_HOST_SUFFIXES = ["npmjs.org", "jsr.io", "esm.sh", "deno.land"];

// Mirrors the old per-tarball compressed cap (installer.ts MAX_TARBALL_BYTES).
const MAX_RESPONSE_BYTES = 30 * 1024 * 1024;

let installed = false;

/** Install the guard over `globalThis.fetch`. Idempotent. */
export function installFetchGuard(): void {
  if (installed) return;
  installed = true;
  globalThis.fetch = createGuardedFetch(globalThis.fetch.bind(globalThis));
}

/** Wrap a fetch implementation with the host allowlist + per-response size cap.
 *  Exposed (with an injectable cap) so the policy is testable without mutating
 *  the global. */
export function createGuardedFetch(
  originalFetch: typeof fetch,
  maxBytes = MAX_RESPONSE_BYTES,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!isAllowedHost(url.hostname)) {
      logEvent("warn", "base44.bundler.fetch_blocked", { host: url.hostname });
      throw new Error(
        `Blocked fetch to disallowed host "${url.hostname}". Allowed: the npm and jsr registries and the esm.sh / deno.land CDNs — import dependencies via npm:, jsr:, or an https: URL on one of those hosts.`,
      );
    }

    const response = await originalFetch(input, init);

    // Size cap via Content-Length only — never read or rewrap the body, so the
    // original Response reaches the loader untouched.
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      logEvent("warn", "base44.bundler.fetch_too_large", {
        host: url.hostname,
        bytes: declared,
      });
      throw new Error(
        `Dependency download is ${declared} bytes, over the ${maxBytes}-byte limit.`,
      );
    }
    return response;
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}
