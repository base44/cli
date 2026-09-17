/**
 * The two seams the extraction added, plus the surface the package publishes.
 *
 * apper's service relies on both hooks staying wired: it registers a dd-trace
 * adapter and keeps the Datadog JSON log line the bundler has always written.
 * A CLI build relies on being able to silence that line.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { bundle } from "../src/bundler";
import * as publicSurface from "../src/index";
import { type Field, type Level, logEvent, setLogSink } from "../src/log";
import { type CompilerTracer, setCompilerTracer } from "../src/tracing";

const HELLO = {
  entry: "main.ts",
  files: { "main.ts": 'Deno.serve(() => new Response("ok"));' },
};

afterEach(() => {
  setLogSink(null);
  setCompilerTracer(null);
  vi.restoreAllMocks();
});

describe("log sink", () => {
  it("writes the Datadog JSON line by default", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logEvent("info", "base44.bundler.test", { specifier: "x" });
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
      status: "info",
      event: "base44.bundler.test",
      specifier: "x",
    });
  });

  it("routes warn and error to their own console channels", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logEvent("warn", "base44.bundler.warn");
    logEvent("error", "base44.bundler.error");
    expect(warn).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
  });

  it("drops undefined fields so absent dimensions make no facet", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logEvent("info", "base44.bundler.test", { present: 1, absent: undefined });
    const line = JSON.parse(log.mock.calls[0][0] as string);
    expect(line).toHaveProperty("present", 1);
    expect(line).not.toHaveProperty("absent");
  });

  it("hands events to a registered sink instead, and restores on null", () => {
    const seen: [Level, string, Record<string, Field>][] = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    setLogSink((level, event, fields) => seen.push([level, event, fields]));

    logEvent("info", "base44.bundler.routed", { n: 1 });
    expect(seen).toEqual([["info", "base44.bundler.routed", { n: 1 }]]);
    expect(log).not.toHaveBeenCalled();

    setLogSink(null);
    logEvent("info", "base44.bundler.default");
    expect(log).toHaveBeenCalledOnce();
  });
});

describe("compiler tracer", () => {
  it("compiles with no tracer registered", async () => {
    const result = await bundle(HELLO);
    expect(result.ok).toBe(true);
  });

  it("wraps the compile in a span and tags its outcome", async () => {
    const spans: string[] = [];
    const tags: Record<string, string | number | undefined> = {};
    const tracer: CompilerTracer = {
      withSpan: (name, fn) => {
        spans.push(name);
        return fn();
      },
      setSpanTags: async (t) => void Object.assign(tags, t),
    };
    setCompilerTracer(tracer);

    const result = await bundle(HELLO);

    expect(result.ok).toBe(true);
    expect(spans).toContain("base44.bundler.compile");
    // apper's dashboards read both: `node_modules_mode` shows the resolver
    // fallback firing, `outcome` whether it rescued the build.
    expect(tags).toMatchObject({ node_modules_mode: "none", outcome: "ok" });
  });

  it("stops calling a tracer once it is cleared", async () => {
    const withSpan = vi.fn((_name: string, fn: () => Promise<unknown>) => fn());
    setCompilerTracer({
      withSpan: withSpan as CompilerTracer["withSpan"],
      setSpanTags: async () => {},
    });
    await bundle(HELLO);
    expect(withSpan).toHaveBeenCalled();

    withSpan.mockClear();
    setCompilerTracer(null);
    await bundle(HELLO);
    expect(withSpan).not.toHaveBeenCalled();
  });
});

describe("published surface", () => {
  it("exports what the two consumers import", () => {
    // A rename here silently breaks apper's service at its next upgrade, and
    // nothing else in the suite imports through the package entry point.
    expect(Object.keys(publicSurface).sort()).toEqual(
      [
        "DenoCompatError",
        "STATIC_EGRESS_ARTIFACT_MARKER",
        "appFunctionSchema",
        "bundle",
        "bundleAppRequestSchema",
        "bundleApp",
        "bundleRequestSchema",
        "classifyAppErrors",
        "createGuardedFetch",
        "importsConflictingPackage",
        "installFetchGuard",
        "setCompilerTracer",
        "setLogSink",
        "cfwBundleInput",
        "collectReachableFiles",
        "compileFunctionShards",
        "ShardCapacityError",
        "assertWithinCapacity",
        "planFreshShards",
        "targetShardCount",
        "BUNDLE_GZIP_LEVEL",
        "WORKER_RAW_SIZE_CEILING_BYTES",
        "judgeBundleSize",
        "measureBundleBytes",
        "workerGzipCapBreach",
        "workerRawSizeBreach",
      ].sort(),
    );
  });

  it("keeps the static-egress marker in step with the Python constant", () => {
    // backend/app/static_egress/config.py holds the same literal; they are one
    // capability marker read on both sides of the HTTP boundary.
    expect(publicSurface.STATIC_EGRESS_ARTIFACT_MARKER).toBe(
      "base44.static-egress.request-env.v2",
    );
  });
});
