/**
 * `sourceMap: true` — an external map beside the module whose `sources` name
 * the app's own files, so a stack frame can be remapped to the file a user
 * wrote (by Cloudflare for an uncaught exception, by the consumer for a
 * logged stack). Everything the compiler adds stays in the list (the mappings
 * index into it) behind a `base44-internal:` prefix.
 */

import { SourceMap } from "node:module";

import { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";

import { bundle, bundleApp } from "../src/bundler";
import { INTERNAL_SOURCE_PREFIX } from "../src/source-map";
import { runInWorkerd, WFP_COMPAT_DATE } from "./workerd";

const MAP_COMMENT = "\n//# sourceMappingURL=_bundled.mjs.map\n";

/** A TypeScript function with a shared module and an npm import. `marker`
 *  survives minification, so a test can find its generated position. */
function fixture(marker: string): Record<string, string> {
  return {
    "main.ts": [
      'import slugify from "npm:slugify@1.6.6";',
      'import { describe } from "./lib/shared.ts";',
      "",
      'Deno.serve(() => new Response(describe(slugify("Hello There"))));',
      "",
    ].join("\n"),
    "lib/shared.ts": [
      "export function describe(slug: string): string {",
      `  return \`${marker}:\${slug}\`;`,
      "}",
      "",
    ].join("\n"),
  };
}

interface RawMap {
  version: number;
  sources: string[];
  mappings: string;
  sourceRoot?: string;
  sourcesContent?: unknown;
}

function parse(map: string | undefined): RawMap {
  expect(map).toBeTypeOf("string");
  return JSON.parse(map as string) as RawMap;
}

/** The sources that name app files: everything without the internal prefix. */
function appSources(map: RawMap): Set<string> {
  return new Set(map.sources.filter((s) => !s.startsWith(INTERNAL_SOURCE_PREFIX)));
}

function expectNoInternalFileNamedAsApp(map: RawMap): void {
  for (const source of map.sources) {
    if (source.includes("__base44_")) {
      expect(source.startsWith(INTERNAL_SOURCE_PREFIX), source).toBe(true);
    }
  }
}

/** Map the first occurrence of `needle` in the module back to its origin. */
function originOf(module: string, map: string, needle: string) {
  const offset = module.indexOf(needle);
  expect(offset, `"${needle}" in module`).toBeGreaterThanOrEqual(0);
  const before = module.slice(0, offset);
  const line = before.split("\n").length - 1;
  const column = offset - (before.lastIndexOf("\n") + 1);
  const entry = new SourceMap(JSON.parse(map)).findEntry(line, column);
  return entry as { originalSource?: string; originalLine?: number };
}

describe("sourceMap off (the default)", () => {
  it("returns no map and no sourceMappingURL comment", async () => {
    const single = await bundle({ entry: "main.ts", files: fixture("m") });
    const app = await bundleApp({
      functions: [{ name: "alpha", entry: "main.ts", files: fixture("m") }],
    });
    if (!single.ok || !app.ok) throw new Error("bundle failed");
    expect("source_map" in single).toBe(false);
    expect("source_map" in app).toBe(false);
    expect(single.module).not.toContain("sourceMappingURL");
    expect(app.module).not.toContain("sourceMappingURL");
  });
});

describe("sourceMap on, single function", () => {
  it("names exactly the app's files, and the module differs only by the trailing comment", async () => {
    const files = fixture("single-marker");
    const off = await bundle({ entry: "main.ts", files });
    const on = await bundle({ entry: "main.ts", files, sourceMap: true });
    if (!off.ok || !on.ok) throw new Error("bundle failed");

    // Cloudflare reads the comment to find the uploaded `_bundled.mjs.map`.
    expect(on.module).toBe(off.module + MAP_COMMENT.slice(1));

    const map = parse(on.source_map);
    expect(map.version).toBe(3);
    expect(map.sourceRoot).toBeUndefined();
    expect(map.sourcesContent).toBeUndefined();
    expect(appSources(map)).toEqual(new Set(["main.ts", "lib/shared.ts"]));
    expectNoInternalFileNamedAsApp(map);
    // The npm module, the shim and the generated entry stay listed.
    expect(map.sources).toContain(`${INTERNAL_SOURCE_PREFIX}user:__base44_entry.mjs`);
    expect(map.sources).toContain(`${INTERNAL_SOURCE_PREFIX}user:__base44_deno_shim.mjs`);
    expect(map.sources.some((s) => s.includes("slugify"))).toBe(true);
  });

  it("maps a generated position back to the original file and line", async () => {
    const r = await bundle({
      entry: "main.ts",
      files: fixture("single-marker"),
      sourceMap: true,
    });
    if (!r.ok) throw new Error("bundle failed");
    const origin = originOf(r.module, r.source_map as string, "single-marker:");
    expect(origin.originalSource).toBe("lib/shared.ts");
    // Zero-based: the template literal is on the file's second line.
    expect(origin.originalLine).toBe(1);
  });

  it("writes entryPath for the entry and leaves the other files alone", async () => {
    const r = await bundle({
      entry: "main.ts",
      entryPath: "functions/hello.ts",
      files: fixture("m"),
      sourceMap: true,
    });
    if (!r.ok) throw new Error("bundle failed");
    expect(appSources(parse(r.source_map))).toEqual(new Set(["functions/hello.ts", "lib/shared.ts"]));
  });

  it("still runs in workerd with the comment in place", async () => {
    const r = await bundle({ entry: "main.ts", files: fixture("run-marker"), sourceMap: true });
    if (!r.ok) throw new Error("bundle failed");
    const res = await runInWorkerd(r.module);
    expect(res).toEqual({ status: 200, text: "run-marker:Hello-There" });
  });
});

describe("sourceMap on, per-app bundle", () => {
  it("strips fn_<index>/ and applies each function's own entryPath", async () => {
    const r = await bundleApp({
      functions: [
        { name: "alpha", entry: "main.ts", entryPath: "functions/alpha.ts", files: fixture("alpha-marker") },
        { name: "beta", entry: "main.ts", files: fixture("beta-marker") },
      ],
      sourceMap: true,
    });
    if (!r.ok) throw new Error("bundleApp failed");
    expect(r.module.endsWith(MAP_COMMENT)).toBe(true);

    const map = parse(r.source_map);
    expect(map.sourcesContent).toBeUndefined();
    // alpha's entry is renamed; beta has no entryPath and keeps `main.ts`.
    expect(appSources(map)).toEqual(new Set(["functions/alpha.ts", "main.ts", "lib/shared.ts"]));
    expect(map.sources.filter((s) => s === "lib/shared.ts")).toHaveLength(2);
    expect(map.sources.some((s) => s.startsWith("fn_"))).toBe(false);
    expectNoInternalFileNamedAsApp(map);
    expect(map.sources).toContain(`${INTERNAL_SOURCE_PREFIX}user:__base44_fn_0.mjs`);
    expect(map.sources).toContain(`${INTERNAL_SOURCE_PREFIX}user:__base44_fn_1.mjs`);

    const origin = originOf(r.module, r.source_map as string, "beta-marker:");
    expect(origin.originalSource).toBe("lib/shared.ts");
    expect(origin.originalLine).toBe(1);
  });

  it("keeps the map's function indices right after an exclude-and-rebuild", async () => {
    // fn_0 fails to resolve, so the module is rebuilt from fn_1 alone; its
    // files are still namespaced `fn_1/`, and must still resolve to beta.
    const r = await bundleApp({
      functions: [
        { name: "broken", entry: "main.ts", files: { "main.ts": 'import "./missing.ts";' } },
        { name: "beta", entry: "main.ts", entryPath: "functions/beta.ts", files: fixture("beta-marker") },
      ],
      sourceMap: true,
    });
    if (!r.ok) throw new Error("bundleApp failed");
    expect(r.functions.map((f) => f.ok)).toEqual([false, true]);
    expect(appSources(parse(r.source_map))).toEqual(new Set(["functions/beta.ts", "lib/shared.ts"]));
  });
});

describe("rewritten sources are pinned", () => {
  // No npm import, so no machine-dependent cache path lands in the list.
  const files = {
    "main.ts": 'import { greet } from "./lib/greet.ts";\nDeno.serve(() => new Response(greet()));\n',
    "lib/greet.ts": 'export const greet = () => "hi";\n',
  };

  it("for the single-function entry", async () => {
    const r = await bundle({ entry: "main.ts", files, sourceMap: true });
    if (!r.ok) throw new Error("bundle failed");
    expect(parse(r.source_map).sources).toMatchSnapshot();
  });

  it("for the per-app entry", async () => {
    const r = await bundleApp({
      functions: [{ name: "alpha", entry: "main.ts", files }],
      sourceMap: true,
    });
    if (!r.ok) throw new Error("bundleApp failed");
    expect(parse(r.source_map).sources).toMatchSnapshot();
  });
});

describe("a crash's stack, as a Tail Worker receives it", () => {
  // Cloudflare remaps an uncaught exception's stack with the uploaded map,
  // after the invocation; local workerd does not. So this maps the runtime's
  // own frames through `source_map` by hand: it proves the positions workerd
  // reports line up with the map. Cloudflare's remapping itself needs a
  // deployed check.
  const files = {
    "main.ts": 'import { fail } from "./lib/fail.ts";\nDeno.serve(() => fail());\n',
    "lib/fail.ts": 'export function fail(): Response {\n  throw new Error("kaboom-from-lib");\n}\n',
  };

  interface TailEvent {
    exceptions: { message: string; stack?: string }[];
    logs: { message: unknown[] }[];
  }

  async function crash(module: string, headers: Record<string, string>): Promise<TailEvent[]> {
    const events: TailEvent[] = [];
    const mf = new Miniflare({
      workers: [
        {
          name: "fn",
          modules: [{ type: "ESModule", path: "_bundled.mjs", contents: module }],
          compatibilityDate: WFP_COMPAT_DATE,
          compatibilityFlags: ["nodejs_compat"],
          tails: ["tail"],
        },
        {
          name: "tail",
          modules: true,
          compatibilityDate: WFP_COMPAT_DATE,
          script: `export default {
            async tail(events, env) {
              await env.SINK.fetch("http://sink/", { method: "POST", body: JSON.stringify(events) });
            },
          };`,
          serviceBindings: {
            SINK: async (req) => {
              events.push(...((await req.json()) as TailEvent[]));
              return new Response("ok");
            },
          },
        },
      ],
    });
    try {
      await (await mf.dispatchFetch("http://localhost/", { headers })).text();
      const until = Date.now() + 5000;
      while (events.length === 0 && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 20));
      }
    } finally {
      await mf.dispose();
    }
    return events;
  }

  /** Each `_bundled.mjs:line:col` frame, mapped to its original file and line. */
  function remap(stack: string, map: string): { source?: string; line: number }[] {
    const sm = new SourceMap(JSON.parse(map));
    return [...stack.matchAll(/_bundled\.mjs:(\d+):(\d+)/g)].map((m) => {
      const e = sm.findEntry(Number(m[1]) - 1, Number(m[2]) - 1) as {
        originalSource?: string;
        originalLine?: number;
      };
      return { source: e.originalSource, line: (e.originalLine ?? -1) + 1 };
    });
  }

  it.each([
    ["single function", () => bundle({ entry: "main.ts", files, sourceMap: true }), {}],
    [
      "per-app",
      () => bundleApp({ functions: [{ name: "alpha", entry: "main.ts", files }], sourceMap: true }),
      { "Base44-Function-Name": "alpha" },
    ],
  ] as const)("maps back to the app's files through source_map (%s)", async (_label, build, headers) => {
    const r = await build();
    if (!r.ok) throw new Error("bundle failed");
    const exceptions = (await crash(r.module, headers)).flatMap((e) => e.exceptions);
    expect(exceptions.map((x) => x.message)).toEqual(["kaboom-from-lib"]);
    const stack = exceptions[0].stack ?? "";
    // Minified as it leaves the runtime.
    expect(stack).not.toContain("fail.ts");
    // The throw, then the handler that called it. The per-app banner shifts
    // every line, so this also checks the map accounts for it.
    expect(remap(stack, r.source_map as string).slice(0, 2)).toEqual([
      { source: "lib/fail.ts", line: 2 },
      { source: "main.ts", line: 2 },
    ]);
  });

  it("leaves the stack the per-app entry logs before rethrowing minified", async () => {
    // Cloudflare does not remap a stack string the Worker logs itself: a
    // consumer reading this line has to remap it with `source_map`.
    const r = await bundleApp({ functions: [{ name: "alpha", entry: "main.ts", files }], sourceMap: true });
    if (!r.ok) throw new Error("bundleApp failed");
    const events = await crash(r.module, { "Base44-Function-Name": "alpha" });
    const line = events
      .flatMap((e) => e.logs)
      .map((l) => (l.message[0] as { message?: string } | undefined)?.message ?? "")
      .find((m) => m.includes("kaboom-from-lib"));
    expect(line).toMatch(/_bundled\.mjs:\d+:\d+/);
    expect(line).not.toContain("fail.ts");
    expect(remap(line as string, r.source_map as string)[0]).toEqual({ source: "lib/fail.ts", line: 2 });
  });
});
