/**
 * Which functions go in which shard, for a build with no previous deploy to
 * reuse. Ported from apper's `shard_planning.py` (`target_shard_count`,
 * `full_repartition`) and the capacity refusal in `deploy_app`.
 *
 * Only the fresh path crosses over. Incremental reuse needs the previous
 * deployment map, and the per-app shard-size ratchet is state written across
 * deploys; both stay with the service.
 */

/** Everything the planner is allowed to know. It reads no settings and no
 *  entitlements — the caller resolves these and passes them in. */
export interface ShardPolicy {
  /** Functions packed into one shard. May be lower than `globalShardSize` when
   *  the caller carries a ratcheted override. */
  shardSize: number;
  /** The size capacity is judged at. A lowered `shardSize` changes packing only
   *  and must never lock an app out of deploying. */
  globalShardSize: number;
  maxShards: number;
  /** Compressed ceiling for one shard's module, in bytes. */
  gzipCapBytes: number;
}

export class ShardCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShardCapacityError";
  }
}

/** The three counts have to be whole numbers of at least one. A zero or
 *  negative `shardSize` made the chunking loop below never advance — it hung
 *  rather than refusing, where the Python raises on the same input. */
function assertUsablePolicy(policy: ShardPolicy): void {
  for (const field of ["shardSize", "globalShardSize", "maxShards"] as const) {
    const value = policy[field];
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(
        `ShardPolicy.${field} must be an integer of at least 1, got ${value}`,
      );
    }
  }
}

function ceilDiv(a: number, b: number): number {
  return Math.ceil(a / b);
}

/**
 * How many shards the desired set needs. `maxShards === 1` — sharding off — is
 * always one shard whatever the function count: the whole app bundles into a
 * single Worker, which is the legacy per-app behaviour. Going through the
 * division would trip the capacity check for a flag-off app.
 */
export function targetShardCount(
  functionCount: number,
  shardSize: number,
  maxShards: number,
): number {
  if (maxShards === 1) return 1;
  return ceilDiv(functionCount, shardSize);
}

/**
 * Refuse a set the product cannot hold. Judged at the GLOBAL shard size: a
 * ratcheted-down `shardSize` affects packing only, so judging at it would lock
 * a recovered app out of deploys. The resulting plan may therefore hold more
 * shards than `maxShards` — bounded by the function count, which is no more
 * Workers than the legacy per-function topology used. Do not "tidy" this into a
 * check on the final shard count.
 */
export function assertWithinCapacity(
  functionCount: number,
  policy: ShardPolicy,
): void {
  const needed = targetShardCount(
    functionCount,
    policy.globalShardSize,
    policy.maxShards,
  );
  if (needed > policy.maxShards) {
    throw new ShardCapacityError(
      `App has ${functionCount} functions — over the per-app Worker capacity of ` +
        `${policy.globalShardSize * policy.maxShards} ` +
        `(${policy.maxShards} shards × ${policy.globalShardSize}).`,
    );
  }
}

/**
 * The fresh partition, as a list of shards holding function names.
 *
 * A single planned shard keeps the caller's order; a multi-shard plan sorts by
 * name before chunking. The two differ in apper and the difference is load
 * bearing — function order inside a combined module changes the emitted bytes,
 * so normalising them would be a byte change wearing a cleanup's clothes.
 */
export function planFreshShards(
  names: string[],
  policy: ShardPolicy,
): string[][] {
  assertUsablePolicy(policy);
  assertWithinCapacity(names.length, policy);

  const target = targetShardCount(
    names.length,
    policy.shardSize,
    policy.maxShards,
  );
  if (target <= 1) return [[...names]];

  const sorted = [...names].sort();
  const shards: string[][] = [];
  for (let i = 0; i < sorted.length; i += policy.shardSize) {
    shards.push(sorted.slice(i, i + policy.shardSize));
  }
  return shards;
}
