/**
 * The input shape production actually sends. apper's adapter (`cfw_bundle_input`
 * in backend/app/cloudflare_functions/function_bundle.py) submits the function's
 * REAL repository path as the entry plus every reachable backend file, so
 * relative imports cross directories — nothing like the flat `main.ts` the rest
 * of these specs use.
 *
 * Translated from apper's test_function_bundle.py: those tests prove which files
 * the adapter collects and then assert, in comments, what the compiler does with
 * them. These are the same fixtures, run through the compiler.
 */

import { describe, expect, it } from "vitest";

import { bundle, bundleApp } from "../src/bundler";
import { runInWorkerd } from "./workerd";

const ENTRY = "base44/functions/crossshared/entry.ts";

const serve = (body: string) =>
  `Deno.serve(() => new Response(${body}));`;

async function compile(files: Record<string, string>, entry = ENTRY) {
  return bundle({ entry, files });
}

async function compileOk(files: Record<string, string>, entry = ENTRY) {
  const result = await compile(files, entry);
  if (!result.ok) {
    throw new Error(`bundle failed: ${JSON.stringify(result.errors)}`);
  }
  return result.module;
}

function firstError(result: Awaited<ReturnType<typeof compile>>): string {
  if (result.ok) throw new Error("expected the bundle to be refused");
  return result.errors.map((e) => e.message).join("\n");
}

describe("real repository paths", () => {
  it("resolves a shared module in a sibling directory and runs it", async () => {
    const module = await compileOk({
      [ENTRY]: `import { greet } from "../../shared/greeting.ts";\n${serve('greet("x")')}`,
      "base44/shared/greeting.ts": "export const greet = (n: string) => `hi ${n}`;",
    });
    const res = await runInWorkerd(module);
    expect(res.status).toBe(200);
    expect(res.text).toBe("hi x");
  });

  it("follows a transitive shared import and leaves unreached files out", async () => {
    const module = await compileOk({
      [ENTRY]: `import { a } from "../../shared/a.ts";\n${serve("a")}`,
      "base44/shared/a.ts": 'import { b } from "./b.ts";\nexport const a = b;',
      "base44/shared/b.ts": 'export const b = "transitive";',
      "base44/shared/unused.ts": "export const u = 2;",
    });
    expect(await runInWorkerd(module)).toMatchObject({ text: "transitive" });
    expect(module).not.toContain("export const u = 2");
  });

  it("resolves a relative import inside the function's own directory", async () => {
    const entry = "base44/functions/withinshared/entry.ts";
    const module = await compileOk(
      {
        [entry]: `import { greet } from "./greeting.ts";\n${serve("greet()")}`,
        "base44/functions/withinshared/greeting.ts": 'export const greet = () => "local";',
      },
      entry,
    );
    expect(await runInWorkerd(module)).toMatchObject({ text: "local" });
  });
});

describe("relative imports cannot leave the submission", () => {
  it("refuses a path that escapes into the frontend tree", async () => {
    // `../../../src/lib/x.ts` resolves to `src/lib/x.ts`, which the adapter
    // deliberately excludes from the backend file set.
    const message = firstError(
      await compile({
        [ENTRY]: `import { x } from "../../../src/lib/x.ts";\n${serve("x")}`,
      }),
    );
    expect(message).toContain("../../../src/lib/x.ts");
    expect(message).toContain("bundled with this function");
  });

  it("refuses a relative import with no target", async () => {
    const message = firstError(
      await compile({
        [ENTRY]: `import { greet } from "../../shared/nope.ts";\n${serve('greet("x")')}`,
        "base44/shared/greeting.ts": "export const greet = (n: string) => n;",
      }),
    );
    expect(message).toContain("../../shared/nope.ts");
    expect(message).toContain("bundled with this function");
  });

  it("refuses absolute paths and file: URLs", async () => {
    for (const spec of ["/etc/passwd", "file:///etc/passwd"]) {
      const message = firstError(
        await compile({ [ENTRY]: `import x from "${spec}";\n${serve("x")}` }),
      );
      expect(message).toContain("absolute paths and file: URLs");
    }
  });

  it("leaves npm: and bare specifiers to the Deno resolver", async () => {
    // Not an escape: these are not graph edges into the submission at all.
    const module = await compileOk({
      [ENTRY]: `import slugify from "npm:slugify@1.6.6";\nimport { greet } from "../../shared/greeting.ts";\n${serve('greet(slugify("Hello There"))')}`,
      "base44/shared/greeting.ts": "export const greet = (n: string) => n;",
    });
    expect(await runInWorkerd(module)).toMatchObject({ text: "Hello-There" });
  });
});

describe("real paths in a combined app build", () => {
  it("compiles two functions that each reach their own shared module", async () => {
    const result = await bundleApp({
      functions: [
        {
          name: "orders",
          entry: "base44/functions/orders/entry.ts",
          files: {
            "base44/functions/orders/entry.ts": `import { tag } from "../../shared/tag.ts";\n${serve('tag("orders")')}`,
            "base44/shared/tag.ts": "export const tag = (n: string) => `[${n}]`;",
          },
        },
        {
          name: "health",
          entry: "base44/functions/health/entry.ts",
          files: {
            "base44/functions/health/entry.ts": serve('"ok"'),
          },
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.functions.every((f) => f.ok)).toBe(true);
  });

  it("reports an escape against the function's own path, without the fn_ prefix", async () => {
    const result = await bundleApp({
      functions: [
        {
          name: "broken",
          entry: "base44/functions/broken/entry.ts",
          files: {
            "base44/functions/broken/entry.ts": `import { x } from "../../../src/lib/x.ts";\n${serve("x")}`,
          },
        },
        { name: "health", entry: "main.ts", files: { "main.ts": serve('"ok"') } },
      ],
    });
    const broken = result.functions.find((f) => f.name === "broken");
    expect(broken?.ok).toBe(false);
    const files = broken?.ok === false ? broken.errors.map((e) => e.file) : [];
    // Attribution strips `fn_<index>/`, so the author sees their own path.
    expect(files.some((f) => f?.startsWith("fn_"))).toBe(false);
  });
});
