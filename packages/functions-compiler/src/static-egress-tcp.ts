import { createStaticEgress } from "./static-egress-tcp-core.mjs";
import { currentWorkerRuntimeContext } from "./private-data-sources/runtime-environment.js";
import { getRuntimeManifest } from "base44:private-data-sources/runtime-manifest-store";

export function installStaticEgressTcp(): void {
  const staticEgress = createStaticEgress(() => {
    const context = currentWorkerRuntimeContext();
    if (!context) return undefined;
    // An empty activation marker means no PDS entries, not a stale-binding fallback.
    const runtimeManifest = getRuntimeManifest();
    return {
      ...context.workerEnv,
      BASE44_PRIVATE_DATA_SOURCES:
        runtimeManifest === undefined
          ? context.workerEnv.BASE44_PRIVATE_DATA_SOURCES
          : runtimeManifest || "[]",
    };
  });
  const globals = globalThis as typeof globalThis & { Base44?: object };
  globals.Base44 = Object.assign(globals.Base44 ?? {}, { staticEgress });
}
