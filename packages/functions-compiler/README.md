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
the payload is JSON so a tool parses it in one call. Only the app path emits it.
The legacy single-function `bundle()` stays bannerless: it compiles one function,
so "which functions are inside" already has its answer. apper's bundler service
now runs this package (it no longer keeps its own engine), and nothing compares
that lane's output byte for byte across engines.

`functions` is sorted whatever order the shard was built in. `telemetry` and
`runtimeSecrets` are there because they change the emitted bytes and a deploy has
to pair its secrets delivery with them. `compiler` is this package's version; it
also tells a consumer which wrapper features a build carries, such as the
`_b44_error` record (see "Error records for a handled 5xx").

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
- either wrapper flag (`postResponseTelemetry`, `runtimeSecrets`). The
  `_b44_error` recorder is not a flag: every build carries it, so it moves the
  bytes only when this package's version does.

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

### Source maps

`sourceMap: true` on either request returns `source_map` beside `module`: an
external source map whose sources name the files a user wrote. It is off by
default, the public CLI never sets it, and with it off the output is unchanged.
With it on, the module differs only by the trailing
`//# sourceMappingURL=_bundled.mjs.map` comment; keep it, and upload the map
beside the module under that name.

What gets remapped, and by whom:

- **An uncaught exception** — the stack in a Tail Worker's `exceptions`.
  Cloudflare remaps it with the uploaded map, after the invocation and outside
  the Worker.
- **A stack the Worker logs itself stays minified**, because the map is not
  available at runtime. That covers the per-app entry's `console.error(e)`
  before it rethrows, and any Error user code logs. A consumer that reads those
  lines remaps them itself with the same version's `source_map`.

Local workerd does no remapping. So the tests here map a Tail exception's
frames through the map by hand, which shows the positions the runtime reports
line up with the map. Cloudflare's own remapping needs a deployed check.

The map carries no `sourcesContent` and no `sourceRoot`. Its `sources` are
rewritten:

- a request file keeps its path; in a per-app bundle the `fn_<index>/` prefix
  is stripped, and the path is checked against that function's own files;
- a function's entry becomes its `entryPath`, when the request sends one — the
  real stored path of a function that was submitted as `main.ts`;
- everything else (the shim, the generated entry and wrappers, the virtual
  runtime modules, npm and remote modules) stays in the list, because the
  mappings index into it, and is prefixed `base44-internal:`.

The per-function probe compiles `bundleApp` runs to attribute errors skip the
map, as they skip telemetry; actor entries and `compileFunctionShards` never
ask for one. Two functions in one per-app
bundle can both list a `main.ts`, so a consumer that needs to know which
function a frame belongs to reads that from the log line, not the map.

### Error records for a handled 5xx

A function that catches its own error and returns a 500 leaves Cloudflare
nothing to record. **Every build** carries a small recorder in its generated
entry (single-function and per-app; not actors), with no build option. That
includes the public CLI's own builds, so an app is ready the moment it opts in,
with no rebuild. It adds about 3 KB to a module (about 1.2 KB gzipped).

The off switch is the request, not the build: the recorder does nothing unless
the request carries `x-b44-feed-context`. The backend sends that header only for
production calls of apps that opted in, while its tail switch is on; turning the
switch off silences the record in every bundle, whatever built it. Without the
header the recorder costs one header check per request and one context lookup
per `console.*` call.

When the header is present and the handler returns a `Response` with status
≥ 500, that same response goes back at once: never rebuilt, never delayed, no
header set. On a clone, inside `ctx.waitUntil`, the recorder:

- picks the message, in this order: an Error logged during the request whose
  message the JSON body repeats (the newest such among the last 8 Errors
  logged, so a later unrelated warning doesn't hide it); else the body (JSON of
  at most 2,048 bytes read within 50 ms; the first non-empty `error`,
  `message`, `detail`, `details` or `error.message`, skipping `error` when it
  is exactly `"Internal server error"` and `details` is present); else the last
  Error logged during the request.
  No message means no record;
- takes the stack only from the logged Error that supplied the message. It is
  that Error's raw `stack`, read inside the Worker, so it is **minified**:
  Cloudflare remaps only the exceptions it captures, never a logged string. A
  consumer remaps it with the same version's `source_map` (see Source maps);
- replaces every env-binding and runtime-secret string of 8+ characters with
  `[redacted]`, longest first, before cutting anything. This includes the strings
  nested in JSON-valued ones (leading whitespace allowed), such as the
  private-data-sources manifest;
- caps `name` at 64 characters, `message` at 500 UTF-8 bytes (well-formed, cut
  on a code point) and `stack` at 4 KB (cut at a line end);
- logs exactly one line, with `console.error({ _b44_error: record })`.

That call goes through the console patch, so **the object is not what a
consumer sees.** A Tail Worker gets one log entry shaped like this:

| Field | Value |
|---|---|
| the TailItem log's `level` | `"log"`. The patch writes every level through the original `console.log` |
| the log's `message` | an array with **one** argument: the patch's wrapper object |
| the wrapper's keys | `_b44_env`, `_b44_function` (per-app bundles only), `level`, `message` |
| the wrapper's `level` | `"error"` |
| the wrapper's `message` | the **JSON string** of `{ "_b44_error": { v: 1, kind: "response", status, name?, message, stack? } }` |

So a consumer keeps logs whose wrapper `level` is `"error"`, then reads
`JSON.parse(wrapper.message)._b44_error`. apper's error tail
(`workers/base44-log-tail/src/error-tail.ts`) is that consumer, and
`error-records.e2e.test.ts` pins this shape for both entries. The record is
logged inside `waitUntil`, after the response has gone back, so it never lands
in the `X-B44-Invocation-Logs` header. It is still an ordinary stamped line, so
views built on stamped Workers log lines show it as an error line.

Any failure writes nothing and never reaches the request. An uncaught throw is
untouched: the entry still logs it and rethrows, and Cloudflare records it.

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

## Static-egress TCP runtime

Compiled functions expose `staticEgress` from `base44:runtime`:

```ts
import { staticEgress } from "base44:runtime";

const socket = await staticEgress.connect({ hostname: "sftp.example.com", port: 2222 });
```

The API reads the current trusted Worker environment, calls only
`STATIC_EGRESS.connect`, and rejects when the workspace gate or binding is
unavailable. It never falls back to direct TCP. The optional second argument
supports only `{ secureTransport: "off" }`; SSH supplies its own encryption.
TLS/STARTTLS and unknown options reject. Callers own authentication, timeouts,
stream locks and socket cleanup. The public socket exposes streams, `opened`,
`closed`, and `close()`.

`src/static-egress-tcp-core.mjs` matches apper's
`backend/app/static_egress/tcp.mjs`, which its bundler and full-stack uploader
share. Keep the source and contract tests aligned until the in-repo compiler is
retired. `build:shim` embeds this core in the runtime shim; it is not a runtime
filesystem dependency. The internal manifest-store importer allowlist includes
the exact injected runtime shim so activation-delivered PDS exclusions are
enforced without making the manifest user-importable.

Release this package before bumping apper's compiler pin. Existing compiled
Workers need rebuilding; the workspace toggle does not install new code.

## Workers compatibility for npm clients

Two gaps in workerd break common Node-targeted npm packages, Stagehand among
them, and the compiler closes both for every function and actor:

- **`ws`.** Its exports map sends the `browser` condition to a stub that throws
  on use. `src/esbuild/ws-native-virtual.ts` resolves bare `ws` and
  `npm:ws[@version]` to a `ws`-shaped client over workerd's native WebSocket
  (`on`/`once`/`off`, `send`, `close`, `terminate`, `readyState`). It covers
  what Stagehand uses, not the whole `ws` API. When the options carry headers
  beyond `User-Agent` (Stagehand's `cdpHeaders`), the socket is opened with a
  `fetch` upgrade so they reach the server, and that connection follows the
  function's egress routing. Other connection options are ignored, and
  `WebSocketServer` throws: a function can open sockets but not listen.
- **`AsyncLocalStorage.enterWith()`.** workerd's version throws. The Deno shim
  replaces it with a no-op, so the store is never seeded. That suits libraries
  that also pass their context explicitly and re-enter it with `run()`. The
  shim probes first and keeps a working native implementation.

## Layout

| Path | What it is |
|---|---|
| `src/bundler.ts` | Single-function and combined-app compilation, error attribution |
| `src/deno-bundle.ts`, `src/esbuild/` | esbuild execution and the resolver/virtual-module plugins |
| `src/worker-entry.ts`, `src/actor-compat.ts` | Generated worker entry and the Actor wrapper |
| `src/shim/`, `src/static-egress.ts` | Shim sources — esbuild inputs for `build:shim`, never imported |
| `src/runtime/`, `src/runtime-context.ts`, `src/private-data-sources/` | Compile-time assets read as **text** and injected into the user bundle |

The compile-time assets must stay TypeScript: the virtual plugins load them
with esbuild's `ts` loader. `scripts/build-shim.ts` embeds them, with the three
shims it builds, as strings in `src/generated/assets.ts`, and everything reads
them through `src/assets.ts`. The compiler reads no file of its own, because a
path relative to `import.meta.url` stops naming the file once a consumer has
bundled it. The generated module is not committed: `prepare` writes it on
install, which the root `package.json` allows through `trustedDependencies` —
bun blocks a dependency's lifecycle scripts by default, and the CLI depends on
this workspace.

`esbuild` and `@deno/loader` are imported on first use (`src/lazy-deps.ts`), not
with the modules that call them. A consumer that bundles the compiler keeps
both external, and a bundler hoists an external's ESM import to the top of its
output — loading a native binary and a WASM module at that consumer's startup
whether it compiles or not.

**Do not reformat an asset.** Their text goes into the user's bundle, so
whitespace is part of the emitted worker bytes — running Biome over
`src/shim/`, `src/private-data-sources/`, `src/runtime/`, `runtime-context.ts`,
`static-egress.ts`, `static-egress-tcp.ts`, `static-egress-tcp-core.mjs`
or `static-egress-marker.ts` changes what every compiled
function hashes to. `biome.json` excludes those paths for that reason. The
`test/` directory is likewise held byte-identical to apper's copy until that
copy is deleted; it sits outside the repo's `packages/*/src` lint glob.

## Commands

```bash
bun run build:shim   # regenerate src/generated/assets.ts (shims + text assets)
bun run test         # vitest (regenerates the assets first)
bun run typecheck    # tsc --noEmit over src/, test/, scripts/
bun run build        # assets + tsc -> lib/; what gets published
```

`exports` points only at `lib/`, the one thing the tarball ships. There is
deliberately no source-resolving export condition: a second resolution path
for the package would mean two answers to "which code ran". The CLI does not
go through `exports` at all — it maps the package to `src/index.ts` in its own
tsconfig and bundles the source `lib/` is compiled from, so its bundle is the
answer for the CLI, and it needs no `bun run build` here first.

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
