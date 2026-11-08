import { describe, expect, it } from "vitest";

import { appSourceMap, functionSourceMap, type SourceMapFunction } from "../src/source-map";

const raw = (sources: string[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 3, sources, mappings: "AAAA", names: [], ...extra });

const sourcesOf = (map: string) => (JSON.parse(map) as { sources: string[] }).sources;

describe("functionSourceMap", () => {
  const fn = { entry: "main.ts", files: { "main.ts": "", "lib/a.ts": "" } };

  it("keeps every source in place, so the mappings' indices still hold", () => {
    const out = sourcesOf(
      functionSourceMap(
        raw(["user:lib/a.ts", "../../cache/npm/x.js", "user:main.ts", "user:__base44_entry.mjs"]),
        fn,
      ),
    );
    expect(out).toEqual([
      "lib/a.ts",
      "base44-internal:../../cache/npm/x.js",
      "main.ts",
      "base44-internal:user:__base44_entry.mjs",
    ]);
  });

  it("replaces only the entry with entryPath", () => {
    const out = sourcesOf(
      functionSourceMap(raw(["user:main.ts", "user:lib/a.ts"]), { ...fn, entryPath: "functions/a.ts" }),
    );
    expect(out).toEqual(["functions/a.ts", "lib/a.ts"]);
  });

  it("treats a user-namespace key that is not a request file as internal", () => {
    // Object keys every record inherits must not read as request files.
    const out = sourcesOf(functionSourceMap(raw(["user:constructor", "user:other.ts"]), fn));
    expect(out).toEqual(["base44-internal:user:constructor", "base44-internal:user:other.ts"]);
  });

  it("drops sourceRoot and sourcesContent", () => {
    const map = JSON.parse(
      functionSourceMap(raw(["user:main.ts"], { sourceRoot: "/tmp/x", sourcesContent: ["secret"] }), fn),
    );
    expect(map).not.toHaveProperty("sourceRoot");
    expect(map).not.toHaveProperty("sourcesContent");
    expect(map.mappings).toBe("AAAA");
  });
});

describe("appSourceMap", () => {
  const functions: SourceMapFunction[] = [
    { entry: "main.ts", files: { "main.ts": "" }, entryPath: "functions/alpha.ts" },
    { entry: "main.ts", files: { "main.ts": "", "lib/b.ts": "" } },
  ];

  it("checks each fn_<index>/ path against that function's own files", () => {
    const out = sourcesOf(
      appSourceMap(
        raw(["user:fn_0/main.ts", "user:fn_1/main.ts", "user:fn_1/lib/b.ts", "user:fn_0/lib/b.ts"]),
        functions,
      ),
    );
    expect(out).toEqual(["functions/alpha.ts", "main.ts", "lib/b.ts", "base44-internal:user:fn_0/lib/b.ts"]);
  });

  it("marks an unknown function index, or a missing slot, as internal", () => {
    const sparse: SourceMapFunction[] = [];
    sparse[1] = functions[1];
    const out = sourcesOf(appSourceMap(raw(["user:fn_0/main.ts", "user:fn_7/main.ts", "user:fn_1/main.ts"]), sparse));
    expect(out).toEqual(["base44-internal:user:fn_0/main.ts", "base44-internal:user:fn_7/main.ts", "main.ts"]);
  });
});
