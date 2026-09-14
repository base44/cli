/**
 * E2E for the shared-dep version-conflict class of assembly failure: every
 * function compiles alone, but the combined app graph resolves a shared npm
 * package onto a version that violates another importer's peer range.
 *
 * Real-world shape (prod app 68da7245efa2ba7a0ede4746): one function imports
 * `npm:date-fns-tz@^2.0.0` (peer: date-fns 2.x, deep-imports
 * `date-fns/format/index.js`), another `npm:date-fns-tz@3.2.0` +
 * `npm:date-fns@4.1.0`; with both tz majors in the graph, tz@2's deep imports
 * can resolve into date-fns@4.1.0 whose exports map doesn't expose them.
 *
 * Whether the mis-resolution fires depends on the resolver's npm cache state
 * (it races concurrent probes), so the hard invariant under test is: bundleApp
 * NEVER crashes on it — a crash becomes a 500, which the platform retries and
 * reports as "infrastructure error" although the failure is deterministic and
 * user-fixable. When it does fire, it must surface as a compile error on the
 * function importing the failing major, with the rest still assembled.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bundleApp } from "../src/bundler";

const fn = (name: string, source: string) => ({
  name,
  entry: "main.ts",
  files: { "main.ts": source },
});

const TZ_V2_FN = fn(
  "getDashboardData",
  `import { format } from 'npm:date-fns-tz@^2.0.0';
Deno.serve(() => new Response(String(format)));`,
);

const TZ_V3_FN = fn(
  "cleanupForgottenDepartures",
  `import { toZonedTime } from 'npm:date-fns-tz@3.2.0';
import { addMinutes } from 'npm:date-fns@4.1.0';
Deno.serve(() => new Response(String(addMinutes(new Date(), 1))));`,
);

const PLAIN_FN = fn("health", `Deno.serve(() => new Response("ok"));`);

// A fresh DENO_DIR maximizes the odds the conflict fires (and matches a fresh
// prod instance); a warm cache can resolve both majors cleanly.
let denoDir: string;
beforeAll(() => {
  denoDir = mkdtempSync(path.join(tmpdir(), "bundler-conflict-"));
  process.env.DENO_DIR = denoDir;
});
afterAll(() => {
  delete process.env.DENO_DIR;
  rmSync(denoDir, { recursive: true, force: true });
});

describe("bundle-app shared-dep version conflict", () => {
  it(
    "never crashes; when the conflict fires it is attributed per function",
    { timeout: 300_000 },
    async () => {
      // Never throws — that's the contract this path must keep.
      const result = await bundleApp({
        functions: [TZ_V2_FN, TZ_V3_FN, PLAIN_FN],
      });

      const byName = Object.fromEntries(result.functions.map((f) => [f.name, f]));
      // These two never participate in the conflict.
      expect(byName.cleanupForgottenDepartures.ok).toBe(true);
      expect(byName.health.ok).toBe(true);

      const conflicted = byName.getDashboardData;
      if (conflicted.ok) {
        // Cache state let both majors coexist — nothing to attribute.
        expect(result.ok).toBe(true);
        return;
      }
      // Conflict fired: blamed function carries the diagnostics, the rest of
      // the app still assembled into a deployable module.
      expect(result.ok).toBe(true);
      const message = conflicted.errors.map((e) => e.message).join("\n");
      expect(message).toMatch(/version conflict/);
      expect(message).toContain("date-fns-tz");
    },
  );

  it(
    "threads runtime-secrets mode through the conflict fallback",
    { timeout: 300_000 },
    async () => {
      // Regression: the per-function fallback rebuilds survivors via
      // assembleWithoutConflicting → compileApp(rest), which must thread
      // runtimeSecrets — else the survivors ship with neither the activation
      // shim nor bound secrets, so their cold invocations run without env.
      // Only asserts when the conflict actually fires (same cache-dependent
      // condition as above); the non-fallback path is covered elsewhere.
      const result = await bundleApp({
        functions: [TZ_V2_FN, TZ_V3_FN, PLAIN_FN],
        runtimeSecrets: true,
      });
      const byName = Object.fromEntries(result.functions.map((f) => [f.name, f]));
      if (byName.getDashboardData.ok) return; // conflict didn't fire this run
      expect(result.ok).toBe(true);
      // The rebuilt survivor module still carries the activation wrapper.
      expect(result.module).toContain("X-Base44-Needs-Activation");
    },
  );
});
