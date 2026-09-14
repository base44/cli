/**
 * Compile an app's functions into the final Cloudflare Workers shards.
 *
 * The loop is: plan the partition, compile each shard, measure it, and halve any
 * shard whose module is over a ceiling before anything is uploaded. Ported from
 * `_build_shard_with_split` in apper's `cloudflare_wfp_runtime.py`.
 *
 * That function also splits on two exceptions, and neither is a trigger here.
 * The bundler's 413 is its HTTP request-body cap — a property of the shard's
 * packed SOURCE going over the wire, not of the module coming out, and there is
 * no request to reject locally. Cloudflare's 10027 is a real Worker limit, but
 * it is the same 64 MiB `workerRawSizeBreach` already computes from the bytes in
 * hand, so reaching it from a rejected upload is a failsafe, not the design.
 * Measuring is the design, and it happens here.
 *
 * Unlike the compiler's own `bundleApp`, this refuses a partial result. A module
 * missing a handler is not a smaller success, it is a broken app.
 */

import { bundleApp } from "../bundler.js";
import type { AppFunctionInput } from "../contracts.js";
import type { BundleErrorItem } from "../errors.js";
import { planFreshShards, type ShardPolicy } from "./plan.js";
import { judgeBundleSize, type SizeVerdict } from "./size.js";

/** Shards compile independently; bound how many esbuild runs are in flight so
 *  peak memory does not scale with the app's function count. */
const MAX_PARALLEL_SHARDS = 4;

export interface CompiledShard {
  /** Position in the emitted list. Not a deployment identity — the caller owns
   *  placement, and a split makes more shards than the plan had. */
  index: number;
  /** Function names in this shard, in the order they were compiled. */
  functions: string[];
  module: string;
  mainModule: string;
  rawBytes: number;
  gzipBytes: number;
}

export interface ShardBuildFailure {
  /** The function this is about, when it belongs to one. */
  function?: string;
  message: string;
  errors?: BundleErrorItem[];
}

export type ShardBuildResult =
  | { ok: true; shards: CompiledShard[] }
  | { ok: false; failures: ShardBuildFailure[] };

/**
 * Compile every function into shards, or fail the whole build.
 *
 * Succeeds only when each declared function appears exactly once across the
 * shards and every one of them compiled.
 */
export async function compileFunctionShards(
  functions: AppFunctionInput[],
  policy: ShardPolicy,
  options: { postResponseTelemetry?: boolean; runtimeSecrets?: boolean } = {},
): Promise<ShardBuildResult> {
  const duplicate = firstDuplicate(functions.map((fn) => fn.name));
  if (duplicate) {
    return fail([{ message: `Duplicate function name "${duplicate}".` }]);
  }

  const byName = new Map(functions.map((fn) => [fn.name, fn]));
  const plan = planFreshShards(
    functions.map((fn) => fn.name),
    policy,
  );

  const groups = plan.map((names) => names.map((name) => byName.get(name)!));
  const outcomes = await mapWithConcurrency(
    groups,
    MAX_PARALLEL_SHARDS,
    (group) => buildWithSplit(group, policy, options),
  );

  const failures = outcomes.flatMap((o) => (o.ok ? [] : o.failures));
  if (failures.length > 0) return fail(failures);

  const shards = outcomes
    .flatMap((o) => (o.ok ? o.shards : []))
    .map((shard, index) => ({ ...shard, index }));

  const missing = assertEveryFunctionPlacedOnce(functions, shards);
  if (missing.length > 0) return fail(missing);

  return { ok: true, shards };
}

type GroupOutcome =
  | { ok: true; shards: Omit<CompiledShard, "index">[] }
  | { ok: false; failures: ShardBuildFailure[] };

/** Compile one planned group, halving it when its module is over a ceiling. The
 *  verdict comes from the bytes, so nothing is uploaded to discover it. */
async function buildWithSplit(
  group: AppFunctionInput[],
  policy: ShardPolicy,
  options: { postResponseTelemetry?: boolean; runtimeSecrets?: boolean },
): Promise<GroupOutcome> {
  const response = await bundleApp({ functions: group, ...options });

  const compileFailures = response.functions
    .filter((fn) => !fn.ok)
    .map((fn) => ({
      function: fn.name,
      message: `Function "${fn.name}" failed to compile.`,
      errors: fn.ok ? undefined : fn.errors,
    }));
  // A partial module is what the service ships and a whole-app build must not:
  // the peers compiled, but the app is missing a handler.
  if (compileFailures.length > 0)
    return { ok: false, failures: compileFailures };
  if (!response.ok) {
    return fail([{ message: "The combined build produced no module." }]);
  }

  const verdict = await judgeBundleSize(response.module, policy.gzipCapBytes);
  if (!verdict.breach) {
    return {
      ok: true,
      shards: [shardOf(group, response.module, response.main_module, verdict)],
    };
  }

  if (group.length === 1) {
    // Splitting is exhausted: one function's module alone is over the ceiling.
    return {
      ok: false,
      failures: [{ function: group[0].name, message: verdict.breach }],
    };
  }

  const mid = Math.floor(group.length / 2);
  const halves = await Promise.all([
    buildWithSplit(group.slice(0, mid), policy, options),
    buildWithSplit(group.slice(mid), policy, options),
  ]);
  const halfFailures = halves.flatMap((h) => (h.ok ? [] : h.failures));
  if (halfFailures.length > 0) return { ok: false, failures: halfFailures };
  return { ok: true, shards: halves.flatMap((h) => (h.ok ? h.shards : [])) };
}

function shardOf(
  group: AppFunctionInput[],
  module: string,
  mainModule: string,
  verdict: SizeVerdict,
): Omit<CompiledShard, "index"> {
  return {
    functions: group.map((fn) => fn.name),
    module,
    mainModule,
    rawBytes: verdict.rawBytes,
    gzipBytes: verdict.gzipBytes,
  };
}

/** Every declared function must land in exactly one emitted shard. A name that
 *  vanished, or turned up twice after a split, would deploy a broken app. */
function assertEveryFunctionPlacedOnce(
  functions: AppFunctionInput[],
  shards: CompiledShard[],
): ShardBuildFailure[] {
  const placed = new Map<string, number>();
  for (const shard of shards) {
    for (const name of shard.functions) {
      placed.set(name, (placed.get(name) ?? 0) + 1);
    }
  }
  const failures: ShardBuildFailure[] = [];
  for (const fn of functions) {
    const count = placed.get(fn.name) ?? 0;
    if (count !== 1) {
      failures.push({
        function: fn.name,
        message: `Function "${fn.name}" appears in ${count} shards; expected exactly 1.`,
      });
    }
  }
  for (const name of placed.keys()) {
    if (!functions.some((fn) => fn.name === name)) {
      failures.push({
        function: name,
        message: `Shard holds unknown function "${name}".`,
      });
    }
  }
  return failures;
}

function firstDuplicate(names: string[]): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return null;
}

function fail(failures: ShardBuildFailure[]): ShardBuildResult {
  return { ok: false, failures };
}

/** Bounded concurrency, input order preserved. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
