import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildImportMapArg } from "@/cli/dev/dev-server/import-map.js";

interface ParsedMap {
  imports: Record<string, string>;
  scopes: Record<string, Record<string, string>>;
}

const parse = (arg: string): ParsedMap => {
  expect(arg.startsWith("data:application/json,")).toBe(true);
  return JSON.parse(
    decodeURIComponent(arg.slice("data:application/json,".length)),
  ) as ParsedMap;
};

describe("buildImportMapArg", () => {
  let assets: string;
  let project: string;
  let basePath: string;

  beforeEach(async () => {
    assets = await mkdtemp(join(tmpdir(), "b44-im-assets-"));
    project = await mkdtemp(join(tmpdir(), "b44-im-project-"));
    basePath = join(assets, "import-map.json");
    await writeFile(
      basePath,
      JSON.stringify({ imports: { "base44:runtime": "./base44-runtime.ts" } }),
    );
  });

  afterEach(async () => {
    await rm(assets, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  });

  it("resolves base44:runtime to the shipped shim", async () => {
    const map = parse(buildImportMapArg(basePath, project));

    expect(map.imports["base44:runtime"]).toBe(
      pathToFileURL(join(assets, "base44-runtime.ts")).href,
    );
  });

  it("keeps a project's own aliases working instead of overriding them", async () => {
    await writeFile(
      join(project, "deno.json"),
      JSON.stringify({ imports: { "my-alias/": "./lib/" } }),
    );

    const map = parse(buildImportMapArg(basePath, project));

    // The project alias survives, made absolute against the project's config
    // so it still points at the project rather than the merged map.
    expect(map.imports["my-alias/"]).toBe(
      `${pathToFileURL(join(project, "lib")).href}/`,
    );
    // And the Base44 entry is still there alongside it.
    expect(map.imports["base44:runtime"]).toContain("base44-runtime.ts");
  });

  it("reads deno.jsonc, including comments", async () => {
    await writeFile(
      join(project, "deno.jsonc"),
      '{\n  // trailing commas and comments are legal here\n  "imports": { "aliased/": "./src/" },\n}',
    );

    const map = parse(buildImportMapArg(basePath, project));

    expect(map.imports["aliased/"]).toBe(
      `${pathToFileURL(join(project, "src")).href}/`,
    );
  });

  it("does not let a project repoint base44:runtime", async () => {
    await writeFile(
      join(project, "deno.json"),
      JSON.stringify({ imports: { "base44:runtime": "./evil.ts" } }),
    );

    const map = parse(buildImportMapArg(basePath, project));

    expect(map.imports["base44:runtime"]).toContain("base44-runtime.ts");
    expect(map.imports["base44:runtime"]).not.toContain("evil.ts");
  });

  it("leaves non-relative specifiers untouched", async () => {
    await writeFile(
      join(project, "deno.json"),
      JSON.stringify({
        imports: { zod: "npm:zod@3.23.8", "@std/path": "jsr:@std/path@1" },
      }),
    );

    const map = parse(buildImportMapArg(basePath, project));

    expect(map.imports.zod).toBe("npm:zod@3.23.8");
    expect(map.imports["@std/path"]).toBe("jsr:@std/path@1");
  });

  it("carries over project scopes", async () => {
    await writeFile(
      join(project, "deno.json"),
      JSON.stringify({ scopes: { "./vendor/": { foo: "./vendor/foo.ts" } } }),
    );

    const map = parse(buildImportMapArg(basePath, project));

    const scope = `${pathToFileURL(join(project, "vendor")).href}/`;
    expect(map.scopes[scope]?.foo).toBe(
      pathToFileURL(join(project, "vendor", "foo.ts")).href,
    );
  });

  it("still produces a usable map when the project has no Deno config", async () => {
    const map = parse(buildImportMapArg(basePath, project));

    expect(Object.keys(map.imports)).toEqual(["base44:runtime"]);
  });

  it("ignores a malformed project config rather than failing the spawn", async () => {
    await writeFile(join(project, "deno.json"), "{ this is not json");

    const map = parse(buildImportMapArg(basePath, project));

    expect(map.imports["base44:runtime"]).toContain("base44-runtime.ts");
  });
});
