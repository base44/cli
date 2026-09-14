/**
 * Shared helpers for the compiler specs: compile in-process and assert success.
 *
 * The HTTP-envelope helpers (postBundle/bundleOk) stay with the bundler service
 * in apper — those cover the service's contract, not the engine's.
 */

import { bundle, bundleApp } from "../src/bundler";

/** Bundle in-process (no HTTP server) for specs that run the output in Miniflare. */
export async function bundleOrThrow(
  src: string,
  entry = "main.ts",
  postResponseTelemetry = false,
  runtimeSecrets = false,
): Promise<string> {
  const r = await bundle({
    entry,
    files: { [entry]: src },
    postResponseTelemetry,
    runtimeSecrets,
  });
  if (!r.ok) throw new Error(`bundle failed: ${JSON.stringify(r.errors)}`);
  return r.module;
}

/** Bundle a multi-function app in-process; entry defaults to main.ts per function. */
export async function bundleAppOrThrow(
  functions: { name: string; entry?: string; files: Record<string, string> }[],
  postResponseTelemetry = false,
  runtimeSecrets = false,
): Promise<string> {
  const r = await bundleApp({
    functions: functions.map((f) => ({ ...f, entry: f.entry ?? "main.ts" })),
    postResponseTelemetry,
    runtimeSecrets,
  });
  if (!r.ok) throw new Error(`bundleApp failed: ${JSON.stringify(r.functions)}`);
  return r.module;
}
