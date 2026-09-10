# @base44/functions-compiler

Production compiler for Base44 backend functions. Takes function sources as
data and returns a single Cloudflare Workers module — the generated worker
entry, the Deno shim, the runtime and private-data-source modules, and npm/jsr
dependency resolution through `@deno/loader` + esbuild.

Two consumers share this one engine:

- the **Base44 CLI**, which compiles locally (and inside the platform's build
  sandbox) with no network service in the path;
- apper's **`base44-userapp-bundler`** HTTP service, which keeps its own
  endpoints, auth, worker pool and telemetry around it.

## Using it

```ts
import { bundle, bundleApp } from "@base44/functions-compiler";

const result = await bundle({
  entry: "main.ts",
  files: { "main.ts": "export default { fetch: () => new Response('hi') }" },
});
if (result.ok) console.log(result.module);
```

`bundleApp` compiles several functions into one combined module and reports
per-function status; a successful response can still contain failed functions,
so a caller that needs a whole-app build must reject those itself.

### Process isolation

`installFetchGuard()` blocks outbound `fetch` other than the dependency
resolution the compiler itself performs. Install it in the worker or child
process that runs a compile — not in a process that later needs the network.

### Diagnostics

The compiler ships no tracer and no service credentials. Hosts that want spans
or structured logs register their own, in the thread that runs the compile:

```ts
import { setCompilerTracer, setLogSink } from "@base44/functions-compiler";

setCompilerTracer({ withSpan, setSpanTags }); // e.g. a dd-trace adapter
setLogSink((level, event, fields) => myLogger[level](event, fields));
```

Without a sink, `logEvent` writes the Datadog-shaped JSON line it always has.

## Layout

| Path | What it is |
|---|---|
| `src/bundler.ts` | Single-function and combined-app compilation, error attribution |
| `src/deno-bundle.ts`, `src/esbuild/` | esbuild execution and the resolver/virtual-module plugins |
| `src/worker-entry.ts`, `src/actor-compat.ts` | Generated worker entry and the Actor wrapper |
| `src/shim/`, `src/static-egress.ts` | Shim sources — esbuild inputs for `build:shim`, never imported |
| `src/runtime/`, `src/runtime-context.ts`, `src/private-data-sources/` | Compile-time assets read as **text** and injected into the user bundle |

The compile-time assets must stay TypeScript: the virtual plugins load them
with esbuild's `ts` loader. `scripts/copy-assets.ts` copies them into `lib/`
next to the compiled JS so the published package resolves them the same way.

## Commands

```bash
bun run build:shim   # regenerate dist/{deno-shim,activation-shim,actor}.mjs
bun run test         # vitest (builds the shims first)
bun run typecheck    # tsc --noEmit over src/, test/, scripts/
bun run build        # shims + tsc -> lib/ + assets; what gets published
```
