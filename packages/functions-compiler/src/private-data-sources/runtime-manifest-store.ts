// Private, single-instance channel for the handshake-delivered PDS manifest.
//
// The manifest carries plaintext VPC/DB credentials, so it must NOT be
// reachable by user code. It lives here in module-private state: the activation
// shim writes it (via `setRuntimeManifest`) and `manifest.ts` reads it (via
// `getRuntimeManifest`) — both resolve to THIS one module instance in the final
// bundle, so the value never touches `globalThis`, `process.env`, or any
// user-importable surface. User function code cannot import this module, via
// two independent gates: (1) the bundler's private-data-sources virtual plugin
// resolves the `base44:private-data-sources/runtime-manifest-store` specifier
// ONLY when the importer is EXACTLY the injected activation shim's bundle-root
// key (not a suffix/segment match — else a nested `x/__base44_activation.mjs`
// could pose as it); (2) `assertNoReservedFilenames` rejects that basename at
// any depth in user files. The relative `./runtime-manifest-store` path only
// resolves inside the plugin's namespace (the adapters + manifest.ts), never
// from a user file.
//
// Single instance: both importers resolve to the SAME (namespace, path) pair,
// so esbuild emits one module. The runtime-secrets e2e proves this end to end —
// if the two ever diverged into separate instances, the shim would write one
// and manifest.ts would read the other (empty), and the delivered manifest
// would resolve as "not bound".

let runtimeManifestRaw: string | undefined;

export function setRuntimeManifest(raw: string | undefined): void {
  runtimeManifestRaw = raw;
}

export function getRuntimeManifest(): string | undefined {
  return runtimeManifestRaw;
}
