declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}

// Internal virtual specifier: the activation shim imports the manifest store
// through this so build-shim leaves it external and the final app compile
// resolves it (deduped with manifest.ts's relative import). Shapes must match
// src/private-data-sources/runtime-manifest-store.ts.
declare module "base44:private-data-sources/runtime-manifest-store" {
  export function setRuntimeManifest(raw: string | undefined): void;
  export function getRuntimeManifest(): string | undefined;
}
declare module "base44:internal/runtime-context" {
  export {
    currentWorkerRuntimeContext,
    runWithWorkerEnvironment,
    workerEnvironment,
  } from "./runtime-context";
}
