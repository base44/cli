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
  files: {
    "main.ts":
      'import { x } from "./absent.ts";\nDeno.serve(() => new Response(x));',
  },
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
    const result = await compileFunctionShards(
      [fn("alpha"), fn("beta")],
      policy(),
    );
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
    const result = await compileFunctionShards(
      [fn("alpha"), fn("alpha")],
      policy(),
    );
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
    const unbounded = await compileFunctionShards(
      pair,
      policy({ shardSize: 2 }),
    );
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
    const result = await compileFunctionShards(
      [fn("solo")],
      policy({ gzipCapBytes: 64 }),
    );
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

describe("the same input compiles to the same bytes", () => {
  // Load-bearing beyond tidiness: a version's identity is the hash of the
  // compiled artifacts, never of the sources. Anything that shifts the emitted
  // bytes mints a new version of unchanged code — so the compile has to be
  // reproducible, and its inputs have to be the only thing that moves it.
  it("emits identical modules for two runs of one set", async () => {
    const functions = [fn("alpha"), fn("beta"), fn("gamma")];
    const first = await compileFunctionShards(
      functions,
      policy({ shardSize: 2 }),
    );
    const second = await compileFunctionShards(
      functions,
      policy({ shardSize: 2 }),
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.shards.map((s) => s.module)).toEqual(
      first.shards.map((s) => s.module),
    );
  });

  it("is sensitive to caller order inside a single shard", async () => {
    // The single-shard path builds in caller order; only a multi-shard plan
    // sorts by name. So the caller owns a stable order, and this is the test
    // that says so out loud rather than leaving it to a comment.
    const forward = await compileFunctionShards(
      [fn("alpha"), fn("beta")],
      policy({ maxShards: 1 }),
    );
    const reversed = await compileFunctionShards(
      [fn("beta"), fn("alpha")],
      policy({ maxShards: 1 }),
    );
    expect(forward.ok && reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;

    expect(forward.shards).toHaveLength(1);
    expect(reversed.shards).toHaveLength(1);
    expect(reversed.shards[0].module).not.toBe(forward.shards[0].module);
  });
});

/** A payload that gzip cannot collapse, so a shard's compressed size grows with
 *  the number of functions in it — which is what makes a multi-level split
 *  reachable. Deterministic (a fixed-seed xorshift), because a test that
 *  calibrates its own cap must measure the same bytes on every run. */
const incompressible = (chars: number): string => {
  let state = 0x9e3779b9;
  let out = "";
  while (out.length < chars) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out += (state >>> 0).toString(16).padStart(8, "0");
  }
  return out.slice(0, chars);
};

const bulky = (name: string, chars = 40_000) => ({
  name,
  entry: "main.ts",
  files: {
    "main.ts": `const payload = "${incompressible(chars)}";\nDeno.serve(() => new Response(payload.slice(0, 8) + "${name}"));`,
  },
});

describe("splitting more than once", () => {
  // The recursion was only ever exercised one level deep, so the nested flatMap
  // of recursive results went unchecked. apper's own test drives 8 → 4 → 2.
  const eight = [
    "alpha",
    "beta",
    "gamma",
    "delta",
    "epsilon",
    "zeta",
    "eta",
    "theta",
  ].map((name) => bulky(name));

  it("halves again when a half is still over the ceiling", async () => {
    // Calibrate on the real thing: measure a two-function shard and a
    // four-function shard, then set the cap between them. Eight functions then
    // breach, each four still breaches, and only the pairs fit.
    const measure = async (group: typeof eight) => {
      const built = await compileFunctionShards(
        group,
        policy({ shardSize: group.length, maxShards: 1 }),
      );
      expect(built.ok).toBe(true);
      if (!built.ok) throw new Error("calibration compile failed");
      expect(built.shards).toHaveLength(1);
      return built.shards[0].gzipBytes;
    };
    const [pairBytes, quadBytes] = [
      await measure(eight.slice(0, 2)),
      await measure(eight.slice(0, 4)),
    ];
    // If this ever stops holding, the payload has become compressible and the
    // calibration below is meaningless rather than wrong.
    expect(quadBytes).toBeGreaterThan(pairBytes);
    const cap = Math.floor((pairBytes + quadBytes) / 2);

    const result = await compileFunctionShards(
      eight,
      policy({ shardSize: 8, maxShards: 1, gzipCapBytes: cap }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // One planned shard became four, which takes two levels of halving.
    expect(result.shards).toHaveLength(4);
    for (const shard of result.shards) {
      expect(shard.functions).toHaveLength(2);
      expect(shard.gzipBytes).toBeLessThanOrEqual(cap);
    }
    expect(result.shards.flatMap((s) => s.functions).sort()).toEqual(
      eight.map((f) => f.name).sort(),
    );
    expect(result.shards.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  }, 60_000);

  it("fails the whole build when one function survives every halving", async () => {
    // The halves that fit are not a smaller success: a module missing a handler
    // is a broken app. One function is bulky enough to breach alone, so the
    // recursion reaches it and the build must fail rather than emit its
    // siblings.
    const group = [
      bulky("small-a", 2_000),
      bulky("small-b", 2_000),
      bulky("small-c", 2_000),
      bulky("monster", 400_000),
    ];
    const pairBytes = (async () => {
      const built = await compileFunctionShards(
        group.slice(0, 2),
        policy({ shardSize: 2, maxShards: 1 }),
      );
      if (!built.ok) throw new Error("calibration compile failed");
      return built.shards[0].gzipBytes;
    })();
    const cap = (await pairBytes) + 1;

    const result = await compileFunctionShards(
      group,
      policy({ shardSize: 4, maxShards: 1, gzipCapBytes: cap }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failures.map((f) => f.function)).toContain("monster");
    expect(result.failures[0].message).toContain("gzipped");
  }, 60_000);
});
