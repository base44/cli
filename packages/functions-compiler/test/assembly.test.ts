/**
 * Parity fixtures for the source assembly, ported one-for-one from apper's
 * backend/tests/unit/cloudflare_functions/test_function_bundle.py.
 *
 * The Python walks the import graph with tree-sitter and these cases pin what it
 * collects. The port asks esbuild instead, so matching them is the evidence that
 * swapping the parser did not change which files a function is built with.
 */

import { describe, expect, it } from "vitest";

import { cfwBundleInput, collectReachableFiles } from "../src/assembly";
import { bundle } from "../src/bundler";

const ENTRY = "base44/functions/crossshared/entry.ts";

const reached = async (entry: string, files: Record<string, string>) =>
  Object.keys(await collectReachableFiles(entry, files)).sort();

describe("collectReachableFiles", () => {
  it("collects a shared module reached across functions", async () => {
    expect(
      await reached(ENTRY, {
        [ENTRY]:
          'import { greet } from "../../shared/greeting.ts";\nDeno.serve(() => new Response(greet("x")));',
        "base44/shared/greeting.ts": "export const greet = (n: string) => `hi ${n}`;",
        // Another function's subtree must not be pulled in.
        "base44/functions/other/entry.ts": 'import { z } from "../../shared/other.ts";',
        "base44/shared/other.ts": "export const z = 1;",
      }),
    ).toEqual([ENTRY, "base44/shared/greeting.ts"]);
  });

  it("collects a helper inside the function's own directory", async () => {
    const entry = "base44/functions/withinshared/entry.ts";
    expect(
      await reached(entry, {
        [entry]: 'import { greet } from "./greeting.ts";\nconsole.log(greet());',
        "base44/functions/withinshared/greeting.ts": "export const greet = () => 1;",
      }),
    ).toEqual([entry, "base44/functions/withinshared/greeting.ts"]);
  });

  it("follows shared imports transitively and leaves unreached files out", async () => {
    expect(
      await reached(ENTRY, {
        [ENTRY]: 'import { a } from "../../shared/a.ts";',
        "base44/shared/a.ts": 'import { b } from "./b.ts";\nexport const a = b;',
        "base44/shared/b.ts": "export const b = 1;",
        "base44/shared/unused.ts": "export const u = 2;",
      }),
    ).toEqual([ENTRY, "base44/shared/a.ts", "base44/shared/b.ts"]);
  });

  it("does not collect an escape into the frontend tree", async () => {
    // `../../../src/lib/x.ts` resolves to `src/lib/x.ts`, which the caller keeps
    // out of the backend set — so it is never collected and stays forbidden.
    const files = await reached(ENTRY, {
      [ENTRY]:
        'import { x } from "../../../src/lib/x.ts";\nimport { greet } from "../../shared/greeting.ts";',
      "base44/shared/greeting.ts": "export const greet = () => 1;",
    });
    expect(files).toEqual([ENTRY, "base44/shared/greeting.ts"]);
    expect(files.some((f) => f.startsWith("src/"))).toBe(false);
  });

  it("leaves a relative import with no target unresolved", async () => {
    expect(
      await reached(ENTRY, { [ENTRY]: 'import { greet } from "../../shared/missing.ts";' }),
    ).toEqual([ENTRY]);
  });

  it("ignores non-relative specifiers", async () => {
    expect(
      await reached(ENTRY, {
        [ENTRY]:
          'import { createClientFromRequest } from "npm:@base44/sdk";\n' +
          'import { base44 } from "@/api/base44Client";\n' +
          'import { greet } from "../../shared/greeting.ts";',
        "base44/shared/greeting.ts": "export const greet = () => 1;",
      }),
    ).toEqual([ENTRY, "base44/shared/greeting.ts"]);
  });

  it("keeps an import whose bindings are never used", async () => {
    // TypeScript elides an unused import as a presumed type. That would drop a
    // file the function genuinely ships, so the walk must not inherit it.
    expect(
      await reached(ENTRY, {
        [ENTRY]: 'import { unusedButPresent } from "../../shared/side-effect.ts";',
        "base44/shared/side-effect.ts": "export const unusedButPresent = 1;",
      }),
    ).toEqual([ENTRY, "base44/shared/side-effect.ts"]);
  });
});

describe("cfwBundleInput", () => {
  it("stays flat for a single-file function", async () => {
    // No relative imports: byte-identical to how it is submitted today, so the
    // function's compiled output does not move.
    const content = 'import Stripe from "npm:stripe";\nDeno.serve(() => new Response("x"));';
    expect(await cfwBundleInput(ENTRY, content, {})).toEqual({
      entry: "main.ts",
      files: { "main.ts": content },
    });
  });

  it("expands to real paths once a shared module is reached", async () => {
    const content =
      'import { greet } from "../../shared/greeting.ts";\nDeno.serve(() => new Response(greet("x")));';
    const input = await cfwBundleInput(ENTRY, content, {
      "base44/shared/greeting.ts": "export const greet = (n: string) => n;",
    });
    expect(input.entry).toBe(ENTRY);
    expect(Object.keys(input.files).sort()).toEqual([ENTRY, "base44/shared/greeting.ts"]);
  });

  it("stays flat when the escape target is absent, keeping the specifier intact", async () => {
    const content = 'import { x } from "../../../src/lib/x.ts";\nDeno.serve(() => new Response(x));';
    const input = await cfwBundleInput(ENTRY, content, {});
    expect(input).toEqual({ entry: "main.ts", files: { "main.ts": content } });
    // Preserved verbatim, so the compiler refuses it rather than the deploy
    // quietly succeeding against frontend code.
    expect(input.files["main.ts"]).toContain("../../../src/lib/x.ts");
  });

  it("stays flat when a relative target does not exist", async () => {
    const content =
      'import { greet } from "../../shared/nope.ts";\nDeno.serve(() => new Response(greet("x")));';
    const input = await cfwBundleInput(ENTRY, content, {
      "base44/shared/greeting.ts": "export const greet = (n: string) => n;",
    });
    expect(input).toEqual({ entry: "main.ts", files: { "main.ts": content } });
    expect(input.files["main.ts"]).toContain("../../shared/nope.ts");
  });
});

describe("the assembled input compiles", () => {
  it("hands the compiler a set whose shared import resolves", async () => {
    // The assembly is only correct if its output is buildable — the Python
    // fixtures can assert the file set but never this.
    const input = await cfwBundleInput(
      ENTRY,
      'import { greet } from "../../shared/greeting.ts";\nDeno.serve(() => new Response(greet("x")));',
      { "base44/shared/greeting.ts": "export const greet = (n: string) => `hi ${n}`;" },
    );
    const result = await bundle(input);
    expect(result.ok).toBe(true);
  });

  it("hands the compiler a flat set that still fails on an escape", async () => {
    const input = await cfwBundleInput(
      ENTRY,
      'import { x } from "../../../src/lib/x.ts";\nDeno.serve(() => new Response(x));',
      {},
    );
    const result = await bundle(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.message).join("\n")).toContain(
      "bundled with this function",
    );
  });
});
