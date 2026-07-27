# Backend Runtime

The **fallback** local runtime for backend functions.

The default local runtime is workerd via Miniflare (`src/cli/dev/dev-server/miniflare-function-manager.ts` + `function-bundler.ts`) — the same runtime functions deploy to. This Deno-based wrapper is used when the workerd runtime is unavailable: in the compiled standalone binary (which cannot ship workerd's native executable) or when forced with `B44_DEV_FUNCTIONS_RUNTIME=deno`. `base44 exec` also always runs on Deno via `exec.ts`.

Everything in this folder runs in **Deno**, not Node.js. The folder is named for its role rather than for Deno because the deployed runtime it emulates is Cloudflare Workers — but the local executor is Deno, and that is why these files are kept apart from `src/`.

## Why separate?

The CLI itself is a Node.js application, but backend functions are executed in Deno locally. This folder provides a local Deno server for development that mimics the production function runtime.

## TypeScript Configuration

This folder has its own `tsconfig.json` with Deno types (`@types/deno`) instead of Node types. This prevents type conflicts between the two runtimes, and is why `packages/cli/tsconfig.json` excludes this directory from the main program. Neither Biome nor the repo `typecheck` script covers these files — use `deno check --import-map ./import-map.json main.ts base44-runtime.ts exec.ts`.

## Usage

This wrapper is started by `base44 dev` when the workerd runtime is unavailable (see above). `exec.ts` is used by every `base44 exec` invocation.

## Files

| File | Purpose |
| --- | --- |
| `main.ts` | Wrapper that `base44 dev` runs per function. Imports the user's entry file and serves its handler on the CLI-allocated port. |
| `exec.ts` | Wrapper for `base44 exec`. Exposes a pre-authenticated `base44` client as a global, then imports the user's script. |
| `base44-runtime.ts` | Local implementation of the `base44:runtime` module. |
| `import-map.json` | Maps the `base44:runtime` specifier onto `base44-runtime.ts`. |

`main.ts`, `import-map.json`, and `base44-runtime.ts` must stay in the same directory — `function-manager.ts` locates the import map relative to the wrapper.

## Handler contract

A function default-exports an async request handler:

```ts
export default async function (req: Request): Promise<Response> {
  return Response.json({ ok: true });
}
```

A module that exports no handler exits with a clear error rather than hanging until the dev server's readiness timeout.

## The `base44:runtime` module

Deployed functions import secrets and post-response helpers from `base44:runtime`. That module does not exist on a developer machine, so `import-map.json` maps the specifier onto `base44-runtime.ts`.

`function-manager.ts` passes it to Deno with `--import-map`, and passes **only** this map — it is not merged with the project's own `deno.json`.

That is deliberate. Deno resolves its config from the entry point, which is this wrapper inside the assets directory, so a project-level `deno.json` was never applied to locally run functions in the first place. It also could not work deployed: only the files collected for a function are uploaded, and the bundler writes its own `deno.json`, so a project-root alias has nothing to resolve against server-side. Supporting one locally would mean code that runs under `base44 dev` and fails on deploy.

`--import-map` is still preferred over `--config`, which would additionally suppress discovery of a project `deno.json` for everything else it configures.

### Architecture — a delegator over a host bridge

`base44-runtime.ts` mirrors the deployed module (`infra/base44-userapp-bundler/src/runtime/` in `base44-dev/apper`): it holds no state and reads no environment. Both exports delegate to a `globalThis.Base44` bridge that the **host** installs before the function is loaded — `main.ts` here, the generated Worker entry when deployed.

| | host | secrets source | `waitUntil` |
| --- | --- | --- | --- |
| deployed | generated Worker entry | request's Worker env binding (per-request `AsyncLocalStorage`) | `ctx.waitUntil` |
| local | `main.ts` | this process's environment | tracked; rejections logged |

Keeping both sides the same shape means a change to what a secret *is* only touches the host, never the module — so swapping the local source (say, to fetched secrets) needs no change to `base44-runtime.ts`. The bridge is installed before the dynamic import, so a secret read at module scope works. Importing `base44:runtime` with no bridge present throws a clear error rather than failing obscurely.

The signatures match the deployed module: `secrets.get(name): string | undefined` and `waitUntil<T>(promise: Promise<T>): Promise<T>`. Only where the value comes from differs:

- **`secrets.get(name)`** reads the environment `base44 dev` was started with, where deployed it reads the Worker env binding of the current request. Values stored with `base44 secrets set` are deliberately not fetched, so a production secret is never copied onto a developer machine — export the variable in your shell instead. An unset name reads as `undefined`, as deployed; it does not throw. Deployed, a few reserved names are filtered to `undefined`, which is not reproduced locally.
- **`waitUntil(promise)`** has nothing to hold open locally, since the function is a long-lived server process, where deployed it rides `ctx.waitUntil`. The promise is tracked only so a rejection is reported against the function instead of surfacing as an unhandled rejection. It returns the same promise either way, so it composes.

## Relationship to the deployed runtime

Deployed on Cloudflare, the bundler serves `base44:runtime` as a virtual module and invokes the function's default-export handler — the same contract this wrapper implements, so a function behaves the same locally and deployed.

The exception is an app whose backend project is still activated on `v1`/`v2`. There is no bundler on that deploy path, so `base44:runtime` will not resolve and a default-export handler is never served — even though both work under `base44 dev` (on either local runtime). New apps activate on Cloudflare, so this affects already-activated projects only.
