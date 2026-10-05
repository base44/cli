// esbuild and @deno/loader ship a native binary and WASM, so a consumer that
// bundles this compiler keeps them external — and an ESM import of an external
// is hoisted to the top of the bundle, loading both at that consumer's startup
// whether or not it ever compiles. Imported on first use instead.

export function lazyEsbuild(): Promise<typeof import("esbuild")> {
  return import("esbuild");
}

export function lazyDenoLoader(): Promise<typeof import("@deno/loader")> {
  return import("@deno/loader");
}
