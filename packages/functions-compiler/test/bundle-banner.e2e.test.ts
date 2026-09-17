/**
 * The bundle's first line — the only place a compiled module says what is
 * inside it. Every case here is a real compile, because the question is whether
 * the banner survives minification and lands where `head -1` finds it.
 */

import { describe, expect, it } from "vitest";
import { bundle } from "../src/bundler";
import { compileFunctionShards } from "../src/shards/build";
import type { ShardPolicy } from "../src/shards/plan";

const policy = (over: Partial<ShardPolicy> = {}): ShardPolicy => ({
  shardSize: 5,
  globalShardSize: 5,
  maxShards: 4,
  gzipCapBytes: 9_500_000,
  ...over,
});

const fn = (name: string) => ({
  name,
  entry: "main.ts",
  files: { "main.ts": `Deno.serve(() => new Response("${name}"));` },
});

const bannerOf = (module: string) => {
  const first = module.split("\n")[0];
  const match = /^\/\/!b44:(\d+) (.*)$/.exec(first);
  if (!match) {
    throw new Error(`no banner on the first line: ${first.slice(0, 80)}`);
  }
  return { format: Number(match[1]), payload: JSON.parse(match[2]) };
};

describe("the bundle names its own functions", () => {
  it("puts a parseable banner on the first line, past minification", async () => {
    const result = await compileFunctionShards(
      [fn("sendReminder"), fn("health")],
      policy(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { format, payload } = bannerOf(result.shards[0].module);
    expect(format).toBe(1);
    // Sorted, not in caller order: the module below is assembled in caller
    // order and this line deliberately is not.
    expect(payload.functions).toEqual(["health", "sendReminder"]);
    expect(payload.telemetry).toBe(false);
    expect(payload.runtimeSecrets).toBe(false);
    expect(payload.compiler).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("names only the functions in its own shard", async () => {
    const result = await compileFunctionShards(
      [fn("alpha"), fn("beta"), fn("gamma")],
      policy({ shardSize: 2 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.shards).toHaveLength(2);
    for (const shard of result.shards) {
      expect(bannerOf(shard.module).payload.functions).toEqual(
        [...shard.functions].sort(),
      );
    }
  });

  it("reports the wrapper flags it was compiled with", async () => {
    // Both change the emitted bytes and the secrets delivery a deploy must
    // pair with, so the artifact has to carry them rather than be asked.
    const result = await compileFunctionShards([fn("alpha")], policy(), {
      postResponseTelemetry: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(bannerOf(result.shards[0].module).payload.telemetry).toBe(true);
  });

  it("is byte-identical across two compiles of one set", async () => {
    // A version's identity is the hash of these bytes, so a banner carrying
    // anything volatile — a timestamp, a build id — would re-mint a version for
    // code that did not change.
    const functions = [fn("alpha"), fn("beta")];
    const first = await compileFunctionShards(functions, policy());
    const second = await compileFunctionShards(functions, policy());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(bannerOf(second.shards[0].module)).toEqual(
      bannerOf(first.shards[0].module),
    );
  });

  it("leaves the single-function lane's bytes alone", async () => {
    // `bundle()` is the legacy per-function path, and "which functions are
    // inside" has one answer there. Keeping it bannerless keeps that lane
    // byte-comparable with the engine apper still runs in production.
    const result = await bundle({
      entry: "main.ts",
      files: { "main.ts": 'Deno.serve(() => new Response("x"));' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.module.startsWith("//!b44:")).toBe(false);
  });
});
