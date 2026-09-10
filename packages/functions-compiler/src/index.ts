// Public surface of the production function compiler. Everything else under
// src/ is either an internal engine module or a compile-time asset read as text
// by the esbuild plugins.

export { bundle, bundleApp, classifyAppErrors, importsConflictingPackage } from "./bundler.js";
export type {
  AppErrorClassification,
  AppFunctionStatus,
  BundleAppResponse,
  BundleErrorStage,
  BundleResponse,
} from "./bundler.js";

export {
  appFunctionSchema,
  bundleAppRequestSchema,
  bundleRequestSchema,
} from "./contracts.js";
export type {
  AppFunctionInput,
  BundleAppRequest,
  BundleRequest,
} from "./contracts.js";

export { DenoCompatError } from "./errors.js";
export type { BundleErrorItem } from "./errors.js";

export { createGuardedFetch, installFetchGuard } from "./fetch-guard.js";

export { STATIC_EGRESS_ARTIFACT_MARKER } from "./static-egress-marker.js";

export { setCompilerTracer } from "./tracing.js";
export type { CompilerTracer } from "./tracing.js";

export { setLogSink } from "./log.js";
export type { Field, Level, LogSink } from "./log.js";
