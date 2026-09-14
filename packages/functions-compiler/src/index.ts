// Public surface of the production function compiler. Everything else under
// src/ is either an internal engine module or a compile-time asset read as text
// by the esbuild plugins.

export type { BundleInput } from "./assembly.js";
export { cfwBundleInput, collectReachableFiles } from "./assembly.js";
export type {
  AppErrorClassification,
  AppFunctionStatus,
  BundleAppResponse,
  BundleErrorStage,
  BundleResponse,
} from "./bundler.js";
export {
  bundle,
  bundleApp,
  classifyAppErrors,
  importsConflictingPackage,
} from "./bundler.js";
export type {
  AppFunctionInput,
  BundleAppRequest,
  BundleRequest,
} from "./contracts.js";
export {
  appFunctionSchema,
  bundleAppRequestSchema,
  bundleRequestSchema,
} from "./contracts.js";
export type { BundleErrorItem } from "./errors.js";
export { DenoCompatError } from "./errors.js";
export { createGuardedFetch, installFetchGuard } from "./fetch-guard.js";
export type { Field, Level, LogSink } from "./log.js";
export { setLogSink } from "./log.js";
export type {
  CompiledShard,
  ShardBuildFailure,
  ShardBuildResult,
} from "./shards/build.js";
export { compileFunctionShards } from "./shards/build.js";
export type { ShardPolicy } from "./shards/plan.js";
export {
  assertWithinCapacity,
  planFreshShards,
  ShardCapacityError,
  targetShardCount,
} from "./shards/plan.js";
export type { BundleSize, SizeVerdict } from "./shards/size.js";
export {
  BUNDLE_GZIP_LEVEL,
  judgeBundleSize,
  measureBundleBytes,
  WORKER_RAW_SIZE_CEILING_BYTES,
  workerGzipCapBreach,
  workerRawSizeBreach,
} from "./shards/size.js";
export { STATIC_EGRESS_ARTIFACT_MARKER } from "./static-egress-marker.js";
export type { CompilerTracer } from "./tracing.js";
export { setCompilerTracer } from "./tracing.js";
