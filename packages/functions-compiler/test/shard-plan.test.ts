/**
 * Ported from apper's shard_planning.py semantics and the capacity refusal in
 * deploy_app. Only the fresh path exists here; the incremental branch needs the
 * previous deployment map and stays with the service.
 */

import { describe, expect, it } from "vitest";

import {
  ShardCapacityError,
  type ShardPolicy,
  assertWithinCapacity,
  planFreshShards,
  targetShardCount,
} from "../src/shards/plan";

const policy = (over: Partial<ShardPolicy> = {}): ShardPolicy => ({
  shardSize: 5,
  globalShardSize: 5,
  maxShards: 4,
  gzipCapBytes: 9_500_000,
  ...over,
});

describe("targetShardCount", () => {
  it("is always one shard when sharding is off", () => {
    // maxShards === 1 means the whole app bundles into a single Worker whatever
    // the function count — the legacy per-app behaviour. Dividing instead would
    // trip the capacity check for a flag-off app.
    expect(targetShardCount(50, 5, 1)).toBe(1);
  });

  it("divides and rounds up otherwise", () => {
    expect(targetShardCount(1, 5, 4)).toBe(1);
    expect(targetShardCount(5, 5, 4)).toBe(1);
    expect(targetShardCount(6, 5, 4)).toBe(2);
    expect(targetShardCount(11, 5, 4)).toBe(3);
  });
});

describe("capacity", () => {
  it("refuses a set over the product ceiling", () => {
    expect(() => assertWithinCapacity(21, policy())).toThrow(ShardCapacityError);
    expect(() => assertWithinCapacity(21, policy())).toThrow(/capacity of 20/);
  });

  it("accepts a set exactly at the ceiling", () => {
    expect(() => assertWithinCapacity(20, policy())).not.toThrow();
  });

  it("judges capacity at the global size, not a ratcheted-down one", () => {
    // A lowered shardSize changes packing only. Judging capacity at it would
    // lock an app out of deploying precisely because an earlier deploy had to
    // pack smaller — the recovery path would be closed by the recovery itself.
    expect(() =>
      assertWithinCapacity(20, policy({ shardSize: 2, globalShardSize: 5 })),
    ).not.toThrow();
  });
});

describe("planFreshShards", () => {
  it("keeps the caller's order in a single shard", () => {
    // The single-shard path does not sort in apper, and function order inside a
    // combined module changes the emitted bytes.
    expect(planFreshShards(["zebra", "alpha", "mango"], policy())).toEqual([
      ["zebra", "alpha", "mango"],
    ]);
  });

  it("sorts by name before chunking a multi-shard plan", () => {
    expect(planFreshShards(["d", "b", "a", "c"], policy({ shardSize: 2 }))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("packs the remainder into a final short shard", () => {
    expect(planFreshShards(["a", "b", "c"], policy({ shardSize: 2 }))).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });

  it("may plan more shards than maxShards when packing is ratcheted down", () => {
    // Bounded by the function count, which is no more Workers than the legacy
    // per-function topology used. A "shard count <= maxShards" assertion here
    // would refuse an app that deploys fine today.
    const plan = planFreshShards(
      ["a", "b", "c", "d", "e", "f", "g", "h"],
      policy({ shardSize: 1, globalShardSize: 5, maxShards: 2 }),
    );
    expect(plan).toHaveLength(8);
  });

  it("puts everything in one shard when sharding is off", () => {
    const names = ["a", "b", "c", "d", "e", "f"];
    expect(planFreshShards(names, policy({ maxShards: 1 }))).toEqual([names]);
  });

  it("refuses before planning when the set is over capacity", () => {
    expect(() => planFreshShards(new Array(21).fill(0).map((_, i) => `f${i}`), policy())).toThrow(
      ShardCapacityError,
    );
  });
});

describe("an unusable policy is refused, not survived", () => {
  // `shardSize: 0` made the chunking loop never advance: the capacity check
  // passed at the global size and planning then hung. Python raises on the
  // same input.
  it("refuses a shard size that cannot advance", () => {
    expect(() => planFreshShards(["a", "b", "c"], policy({ shardSize: 0 }))).toThrow(
      /shardSize must be an integer of at least 1/,
    );
    expect(() => planFreshShards(["a"], policy({ shardSize: -1 }))).toThrow(
      /at least 1/,
    );
  });

  it("refuses a fractional count", () => {
    expect(() => planFreshShards(["a", "b"], policy({ shardSize: 2.5 }))).toThrow(
      /at least 1/,
    );
  });

  it("refuses the other two counts as well", () => {
    expect(() => planFreshShards(["a"], policy({ globalShardSize: 0 }))).toThrow(
      /globalShardSize/,
    );
    expect(() => planFreshShards(["a"], policy({ maxShards: 0 }))).toThrow(
      /maxShards/,
    );
  });
});
