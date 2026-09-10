/**
 * Real-world npm package matrix — bundle AND execute in workerd.
 *
 * Stress-tests the Deno/Cloudflare bundler with a wide variety of npm packages,
 * one isolated backend function per package (see package-matrix-data.ts). Each
 * function is bundled via `bundle()` and then run in Miniflare-hosted workerd
 * via `runInWorkerd` (production WfP compat config) — so a `pass` means the
 * library actually *executed* and the handler returned its success envelope,
 * not merely that it bundled. This catches runtime-only failures that a
 * bundle-only check misses (e.g. ajv's `new Function` codegen, which workerd
 * forbids). Every entry is a real install from registry.npmjs.org, so this
 * suite is network-bound and slower than the focused bundle.e2e tests.
 *
 * Failing packages are kept on purpose — the failure is the data point about a
 * current platform limitation. Each `expected: "fail"` row is annotated in
 * package-matrix-data.ts; do not "fix" the function to make it pass. When the
 * platform gains the capability, flip the expectation there instead.
 */

import { describe, expect, it } from "vitest";

import { bundle } from "../src/bundler";
import { PACKAGES } from "./package-matrix-data";
import { runInWorkerd } from "./workerd";

type Outcome =
  | { kind: "pass"; output: unknown }
  | { kind: "bundle-fail"; detail: string }
  | { kind: "runtime-fail"; detail: string };

/** Bundle one diagnostic function, run it in workerd, and classify the result.
 *  A clean pass = the worker booted, the handler returned HTTP 200, and the
 *  function self-reported `status: "pass"`. */
async function runPackage(source: string): Promise<Outcome> {
  const r = await bundle({ entry: "main.ts", files: { "main.ts": source } });
  if (!r.ok) return { kind: "bundle-fail", detail: JSON.stringify(r.errors) };

  let status: number;
  let text: string;
  try {
    ({ status, text } = await runInWorkerd(r.module));
  } catch (e) {
    // The worker threw at instantiation (e.g. a dynamic require at module load).
    return { kind: "runtime-fail", detail: `worker-init: ${e instanceof Error ? e.message : String(e)}` };
  }

  let body: { status?: string; output?: unknown; error?: string } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON response */
  }
  if (status === 200 && body?.status === "pass") return { kind: "pass", output: body.output };
  return { kind: "runtime-fail", detail: `status=${status} body=${text.slice(0, 200)}` };
}

describe("npm package matrix (bundle + execute in workerd)", () => {
  it.each(PACKAGES)(
    "$name ($pkg@$version) → expected $expected",
    async ({ expected, source }) => {
      const result = await runPackage(source);

      if (expected === "pass") {
        const detail = result.kind === "pass" ? "" : (result as { detail: string }).detail;
        expect(result.kind, `expected a clean workerd run, got ${result.kind}: ${detail}`).toBe("pass");
        // The handler self-reported success and produced some output.
        expect((result as { output: unknown }).output).toBeTruthy();
      } else {
        // Kept failing on purpose. If it now works, flip `expected` to "pass"
        // in package-matrix-data.ts — don't let it silently start passing.
        expect(result.kind, "this package now works end-to-end — flip expected to 'pass'").not.toBe("pass");
      }
    },
  );
});
