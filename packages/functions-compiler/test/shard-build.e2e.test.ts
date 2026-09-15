/**
 * The compile → measure → split loop, and the rule that separates a whole-app
 * build from what the HTTP service does: a partial result is a failure here.
 *
 * The size fixtures calibrate themselves — they compile the same functions once
 * unbounded and set the cap from what came out — so they stay meaningful as the
 * injected shim and runtime change size.
 */

import { describe, expect, it } from "vitest";

import { compileFunctionShards } from "../src/shards/build";
import type { ShardPolicy } from "../src/shards/plan";
import { measureBundleBytes } from "../src/shards/size";
import { runInWorkerd } from "./workerd";

const policy = (over: Partial<ShardPolicy> = {}): ShardPolicy => ({
  shardSize: 5,
  globalShardSize: 5,
  maxShards: 4,
  gzipCapBytes: 9_500_000,
  ...over,
});

const fn = (name: string, body = `"${name}"`) => ({
  name,
  entry: "main.ts",
  files: { "main.ts": `Deno.serve(() => new Response(${body}));` },
});

const broken = (name: string) => ({
  name,
  entry: "main.ts",
  files: { "main.ts": 'import { x } from "./absent.ts";\nDeno.serve(() => new Response(x));' },
});

describe("a whole-app build", () => {
  it("puts every function in exactly one shard and reports its size", async () => {
    const result = await compileFunctionShards(
      [fn("alpha"), fn("beta"), fn("gamma")],
      policy({ shardSize: 2 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.shards).toHaveLength(2);
    expect(result.shards.flatMap((s) => s.functions).sort()).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    for (const shard of result.shards) {
      expect(shard.rawBytes).toBeGreaterThan(0);
      expect(shard.gzipBytes).toBeGreaterThan(0);
      expect(shard.gzipBytes).toBeLessThan(shard.rawBytes);
      expect(shard.mainModule).toBe("_bundled.mjs");
    }
  });

  it("produces shards that actually route their functions", async () => {
    const result = await compileFunctionShards([fn("alpha"), fn("beta")], policy());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [shard] = result.shards;
    const routed = await runInWorkerd(shard.module, {
      headers: { "Base44-Function-Name": "beta" },
    });
    expect(routed).toMatchObject({ status: 200, text: "beta" });
  });

  it("fails the whole build when one function fails to compile", async () => {
    // The service ships the peers and attributes the failure. A whole-app build
    // cannot: the app would deploy missing a handler.
    const result = await compileFunctionShards(
      [fn("alpha"), broken("beta"), fn("gamma")],
      policy(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((f) => f.function)).toContain("beta");
    expect(result.failures[0].errors?.[0].message).toContain("./absent.ts");
  });

  it("refuses duplicate function names before compiling anything", async () => {
    const result = await compileFunctionShards([fn("alpha"), fn("alpha")], policy());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0].message).toContain("Duplicate");
  });
});

describe("splitting on size", () => {
  it("halves an oversized shard instead of emitting it", async () => {
    // Calibrate against the pair itself: two functions share one injected shim,
    // so a two-function module is only marginally larger than a one-function
    // module. Setting the cap one byte under the pair makes it breach, and each
    // half is necessarily smaller and fits.
    const pair = [fn("alpha"), fn("beta")];
    const unbounded = await compileFunctionShards(pair, policy({ shardSize: 2 }));
    expect(unbounded.ok).toBe(true);
    if (!unbounded.ok) return;
    expect(unbounded.shards).toHaveLength(1);
    const cap = unbounded.shards[0].gzipBytes - 1;

    const result = await compileFunctionShards(
      pair,
      policy({ shardSize: 2, gzipCapBytes: cap }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Planned as one shard, emitted as two — and every function still lands once.
    expect(result.shards).toHaveLength(2);
    expect(result.shards.flatMap((s) => s.functions).sort()).toEqual([
      "alpha",
      "beta",
    ]);
    for (const shard of result.shards) {
      expect(shard.gzipBytes).toBeLessThanOrEqual(cap);
    }
    expect(result.shards.map((s) => s.index)).toEqual([0, 1]);
  });

  it("fails when a single function alone is over the ceiling", async () => {
    // Splitting is exhausted; there is nothing left to halve.
    const result = await compileFunctionShards([fn("solo")], policy({ gzipCapBytes: 64 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0].function).toBe("solo");
    expect(result.failures[0].message).toContain("gzipped");
  });

  it("measures what it emits", async () => {
    const result = await compileFunctionShards([fn("alpha")], policy());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [shard] = result.shards;
    expect(await measureBundleBytes(shard.module)).toEqual({
      rawBytes: shard.rawBytes,
      gzipBytes: shard.gzipBytes,
    });
  });
});
