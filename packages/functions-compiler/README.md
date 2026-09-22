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

## Status and scope

Internal to Base44 — published **public** so apper's bundler service can install
it, but it is not a supported public API: the CLI bundles it at build time so
end users never install it, and it carries no compatibility promise to anyone
outside this repo. Compilation is the whole of its job, and that now includes
source assembly, shard planning, size measurement and splitting. Artifact
writing, version creation, upload and deploy live above it.

The package carries no credentials and reads no configuration of its own. It
names the environment variables and headers the generated worker will use at
runtime (`BASE44_*`, `X-Base44-*`) but holds none of their values, and the code
it ships is the same code already compiled into every deployed user worker.

## Shards and whole-app builds

This package turns an app's whole backend function set into deployable Cloudflare
Workers: it assembles each function's sources, groups them into shards, compiles
each shard, measures it against Cloudflare's ceilings, and halves any shard whose
module is over one. `compileFunctionShards` is the entry point, and unlike
`bundleApp` it refuses a partial result — a module missing a handler is a broken
app, not a smaller success.

Each piece came from apper, and the provenance is worth keeping:

| Piece | Where it came from | Here |
|---|---|---|
| Source assembly | `function_bundle.py` — `cfw_bundle_input`, `collect_reachable_backend_files` | `src/assembly.ts` |
| Fresh shard planning | `shard_planning.py` — `full_repartition`, `target_shard_count` | `src/shards/plan.ts` |
| Size measurement | `cloudflare_wfp_runtime.py` — `measure_bundle_bytes`, `judge_bundle_size` | `src/shards/size.ts` |
| Split on overflow | `cloudflare_wfp_runtime.py` — `_build_shard_with_split` | `src/shards/build.ts` |
| Whole-build validation | apper PR #23460 | `src/shards/build.ts` |

Policy numbers — shard size, shard count, the compressed cap — arrive as inputs.
The package reads no settings and no feature flags, and the two wrapper flags
(`postResponseTelemetry`, `runtimeSecrets`) are handed to it, because both change
the emitted bytes and only the platform knows their value for an app.

Deliberately not here: Deno deployment targets, existing-Worker reuse, provider
upload, binding resolution, secret delivery, and incremental shard reuse — every
version is built from scratch, so nothing here remembers a previous deploy. The
engine keeps its actor support for the legacy service that still uses it.

### What a bundle says about itself

The first line of a compiled shard is its own manifest:

```js
//!b44:1 {"functions":["cleanupForgottenDepartures","health","sendReminder"],"telemetry":false,"runtimeSecrets":false,"compiler":"0.1.0"}
```

`//!b44:<format>` is a fixed sentinel, so `head -1` on a script pulled from
Cloudflare answers "what is in this?" without executing or parsing anything, and
the payload is JSON so a tool parses it in one call. Only the app path emits it;
the legacy single-function `bundle()` stays bannerless, which keeps that lane
byte-comparable with the engine apper still runs.

`functions` is sorted whatever order the shard was built in. `telemetry` and
`runtimeSecrets` are there because they change the emitted bytes and a deploy has
to pair its secrets delivery with them. `compiler` is this package's version.

Nothing volatile may be added: a timestamp or build id would re-mint a version
for unchanged code, the app id would make the same functions compile differently
per app, and the shard's position would make two identical shards differ.

### Reproducibility is a contract, not a nicety

A version's identity is the hash of the **compiled artifacts**, never of the
sources. Anything that shifts the emitted bytes therefore mints a new version of
code that did not change, and all of these do:

- the version of this package, and the depth of the `node_modules` it was built
  against — esbuild writes each vendored chunk's relative path into the minified
  output, so building one directory shallower changes every user Worker's bytes;
- the order the caller hands functions over in, for a single shard: that path
  builds in caller order, while a multi-shard plan sorts by name. Both branches
  are as apper has them, and `shard-build.e2e.test.ts` pins the difference;
- either wrapper flag.

Two behaviours differ from apper's Python on purpose, and both are tested:

- **An unparseable source.** apper reads each file on its own, so a file it
  cannot parse contributes no edges while the rest of the set still assembles.
  esbuild's walk is one build over the whole graph, so anything unparseable in it
  rejects — the fallback is the flat single-file submission, and the compiler then
  reports the error itself.
- **Compressed size.** Node's gzip reads about 0.7% heavier than Python's on
  identical input: 43,057 bytes against 42,765 on a real 122,324-byte module. The
  direction is the safe one, since this lane refuses slightly earlier than the
  service would.

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

**Do not reformat an asset.** Their text goes into the user's bundle, so
whitespace is part of the emitted worker bytes — running Biome over
`src/shim/`, `src/private-data-sources/`, `src/runtime/`, `runtime-context.ts`,
`static-egress.ts` or `static-egress-marker.ts` changes what every compiled
function hashes to. `biome.json` excludes those paths for that reason. The
`test/` directory is likewise held byte-identical to apper's copy until that
copy is deleted; it sits outside the repo's `packages/*/src` lint glob.

## Commands

```bash
bun run build:shim   # regenerate dist/{deno-shim,activation-shim,actor}.mjs
bun run test         # vitest (builds the shims first)
bun run typecheck    # tsc --noEmit over src/, test/, scripts/
bun run build        # shims + tsc -> lib/ + assets; what gets published
```

`exports` points only at `lib/`, so anything consuming this package — including
a sibling workspace — needs `bun run build` here first. There is deliberately
no source-resolving export condition: the tarball ships `lib/` alone, and a
second resolution path would mean two answers to "which code ran".

## Releasing

Run the **Manual Functions Compiler Publish** workflow
(`.github/workflows/functions-compiler-publish.yml`) from the Actions tab. It
bumps the version, syncs the `COMPILER_VERSION` literal, builds `lib/`,
publishes to npm, and pushes a `functions-compiler-v<version>` tag plus the
release commit.

A version lives in two files — `package.json` and the literal in
`src/version.ts` that goes into every compiled shard's banner. Bumping by hand
means running `bun run scripts/sync-version.ts` after editing `package.json`;
`version.test.ts` fails the build if the two drift apart. The CLI's own
release train is a separate workflow with its own `v<version>` tags; the two
never move together.

Authentication is npm **trusted publishing** (OIDC) — no token in the repo. The
registry keys a trusted publisher on the repo *and the workflow filename*, so
`@base44/functions-compiler` needs its own entry on npmjs.com pointing at
`functions-compiler-publish.yml`; the entries for `manual-publish.yml` do not
cover it.

The workflow only builds and publishes. What proves the tarball actually works —
`scripts/verify-package.ts`, which packs, installs the tarball into a throwaway
directory and compiles a real function there — runs in `functions-compiler.yml`
on every push to `main`, behind the Wix embargo gateway. Publish from a commit
that went green there.
