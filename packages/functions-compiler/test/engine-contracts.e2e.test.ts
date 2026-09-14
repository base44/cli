/**
 * Engine guarantees that only apper's HTTP specs asserted. Those specs boot the
 * Hono server and stayed with the service, so the behaviour below — which is the
 * compiler's, not the endpoint's — had no coverage on this side of the move.
 */

import { describe, expect, it } from "vitest";

import { bundle, bundleApp } from "../src/bundler";
import { runInWorkerd } from "./workerd";

const serve = (body: string) => `Deno.serve(() => new Response(${body}));`;

describe("function names", () => {
  it("accepts and routes a nested name containing a slash", async () => {
    // CLI function names can nest. The name is the routing key, so a compiler
    // that quietly rewrote it would break invocation rather than fail loudly.
    const name = "functions/v1/users";
    const result = await bundleApp({
      functions: [
        { name, entry: "main.ts", files: { "main.ts": serve('"nested"') } },
        { name: "health", entry: "main.ts", files: { "main.ts": serve('"ok"') } },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.functions.map((f) => f.name)).toContain(name);

    const routed = await runInWorkerd(result.ok ? result.module : "", {
      headers: { "Base44-Function-Name": name },
    });
    expect(routed).toMatchObject({ status: 200, text: "nested" });
  });
});

describe("combined builds dedupe shared dependencies", () => {
  it("inlines a package imported by two functions only once", async () => {
    // This is the whole reason a shard is one compile rather than N: a second
    // copy of every shared dependency would push each shard toward the size
    // ceiling. `__lodash_hash_undefined__` is lodash's own sentinel and appears
    // once per inlined copy — the same marker apper's endpoint spec counts.
    const source = `import { chunk } from "npm:lodash@4.17.21";\n${serve('String(chunk([1, 2, 3], 2).length)')}`;
    const result = await bundleApp({
      functions: [
        { name: "a", entry: "main.ts", files: { "main.ts": source } },
        { name: "b", entry: "main.ts", files: { "main.ts": source } },
      ],
    });
    expect(result.ok).toBe(true);

    const copies = (result.ok ? result.module : "").split("__lodash_hash_undefined__").length - 1;
    expect(copies).toBeGreaterThan(0);

    const single = await bundleApp({
      functions: [{ name: "a", entry: "main.ts", files: { "main.ts": source } }],
    });
    const singleCopies = (single.ok ? single.module : "").split("__lodash_hash_undefined__").length - 1;
    expect(copies).toBe(singleCopies);
  });
});

describe("compile diagnostics", () => {
  it("locates a syntax error by file, line, column and source text", async () => {
    // The builder agent reads these fields to point the author at the line;
    // an error with only a message sends it guessing.
    const result = await bundle({
      entry: "main.ts",
      files: { "main.ts": 'const x = ;\nDeno.serve(() => new Response("x"));' },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const [error] = result.errors;
    expect(error.file).toBe("main.ts");
    expect(error.line).toBe(1);
    expect(typeof error.column).toBe("number");
    expect(error.lineText).toContain("const x =");
  });

  it("attributes an error in a shared file to that file, not the entry", async () => {
    const result = await bundle({
      entry: "base44/functions/broken/entry.ts",
      files: {
        "base44/functions/broken/entry.ts": 'import { v } from "../../shared/bad.ts";\n' + serve("v"),
        "base44/shared/bad.ts": "export const v = ;",
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.file === "base44/shared/bad.ts")).toBe(true);
  });
});

describe("the import sandbox holds through indirection", () => {
  it("refuses a file: URL reached through a data: module", async () => {
    // A data: module is resolved by the Deno resolver, not the user-files
    // plugin, so this is the path where a filesystem read could slip past the
    // check on the user's own imports.
    const inner = 'export { readFileSync } from "file:///etc/passwd";';
    const dataUrl = `data:text/javascript;base64,${Buffer.from(inner).toString("base64")}`;
    const result = await bundle({
      entry: "main.ts",
      files: { "main.ts": `import * as m from "${dataUrl}";\n${serve("String(m)")}` },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const message = result.errors.map((e) => e.message).join("\n");
    expect(message).toContain("filesystem imports are not allowed");
  });
});

describe("Deno specifier support", () => {
  it("resolves a jsr: import", async () => {
    const result = await bundle({
      entry: "main.ts",
      files: {
        "main.ts": `import { encodeHex } from "jsr:@std/encoding@1.0.5/hex";\n${serve('encodeHex(new Uint8Array([255]))')}`,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await runInWorkerd(result.module)).toMatchObject({ text: "ff" });
  });

  it("keeps a declared optional dependency external instead of failing the build", async () => {
    // axios declares follow-redirects, which is not installed under the Workers
    // target. The author's own guard handles the miss at runtime; refusing the
    // bundle instead would break a package that works in production.
    const result = await bundle({
      entry: "main.ts",
      files: {
        "main.ts": `import axios from "npm:axios@1.7.2";\n${serve("typeof axios")}`,
      },
    });
    expect(result.ok).toBe(true);
  });
});
