/**
 * One transient registry failure deep in a dependency tree must not fail the
 * build. `@deno/loader` never retries, and reports the lost download as "Could
 * not find constraint '<root package>' in the list of packages" — the Stagehand
 * package-matrix row flaked on exactly that in CI.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, expect, it } from "vitest";

import { bundle } from "../src/bundler";

// is-odd@3.0.1 depends on is-number; its metadata fails once.
const FLAKY_URL = "https://registry.npmjs.org/is-number";

let denoDir: string;
let realFetch: typeof fetch;
let flakyHits = 0;
beforeAll(() => {
  // A cold cache, so the loader really downloads is-number.
  denoDir = mkdtempSync(path.join(tmpdir(), "bundler-retry-"));
  process.env.DENO_DIR = denoDir;
  // Replaced before the first bundle, as a host's fetch would be.
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (String(input) === FLAKY_URL && flakyHits++ === 0) {
      return new Response("upstream unavailable", { status: 503 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  delete process.env.DENO_DIR;
  rmSync(denoDir, { recursive: true, force: true });
});

it("retries a dependency download that failed transiently", async () => {
  const result = await bundle({
    entry: "main.ts",
    files: {
      "main.ts": `import isOdd from "npm:is-odd@3.0.1";
Deno.serve(() => new Response(String(isOdd(3))));`,
    },
  });

  expect(result.ok ? [] : result.errors).toEqual([]);
  expect(flakyHits).toBe(2);
});
