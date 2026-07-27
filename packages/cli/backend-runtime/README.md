# Backend Runtime

The local stand-in for the deployed backend function runtime.

Everything in this folder runs in **Deno**, not Node.js. The folder is named for its role rather than for Deno because the deployed runtime it emulates is Cloudflare Workers — but the local executor is Deno, and that is why these files are kept apart from `src/`.

## Why separate?

The CLI itself is a Node.js application, but backend functions are executed in Deno locally. This folder provides a local Deno server for development that mimics the production function runtime.

## TypeScript Configuration

This folder has its own `tsconfig.json` with Deno types (`@types/deno`) instead of Node types. This prevents type conflicts between the two runtimes, and is why `packages/cli/tsconfig.json` excludes this directory from the main program. Neither Biome nor the repo `typecheck` script covers these files — use `deno check --import-map ./import-map.json main.ts base44-runtime.ts exec.ts`.

## Usage

This server is started automatically by `base44 dev` to handle local function deployments.

## Files

| File | Purpose |
| --- | --- |
| `main.ts` | Wrapper that `base44 dev` runs per function. Patches `Deno.serve` to inject the CLI-allocated port, imports the user's entry file, and serves its handler. |
| `exec.ts` | Wrapper for `base44 exec`. Exposes a pre-authenticated `base44` client as a global, then imports the user's script. |
| `base44-runtime.ts` | Local implementation of the `base44:runtime` module. |
| `import-map.json` | Maps the `base44:runtime` specifier onto `base44-runtime.ts`. |

`main.ts`, `import-map.json`, and `base44-runtime.ts` must stay in the same directory — `function-manager.ts` locates the import map relative to the wrapper.

## Supported handler shapes

Both are supported, and a function may mix either handler shape with either secrets API.

```ts
// Preferred — matches the deployed runtime.
export default async function (req: Request): Promise<Response> {
  return Response.json({ ok: true });
}
```

```ts
// Legacy — still accepted.
Deno.serve((req: Request) => Response.json({ ok: true }));
```

A module that calls `Deno.serve` while being imported serves itself, and its default export is ignored. This mirrors the deployed bundler's precedence. If a module neither calls `Deno.serve` nor exports a handler, the wrapper exits with a clear error rather than hanging until the dev server's readiness timeout.

## The `base44:runtime` module

Deployed functions import secrets and post-response helpers from `base44:runtime`. That module does not exist on a developer machine, so `import-map.json` maps the specifier onto `base44-runtime.ts`.

Deno honours exactly one import map, so this one is **merged with the project's own** rather than handed over directly — see `src/cli/dev/dev-server/import-map.ts`. If the project has a `deno.json` or `deno.jsonc`, its `imports` and `scopes` are read and combined with the Base44 entries, and every relative specifier is made absolute first (relative entries resolve against the file that declared them, so combining two maps without absolutising would silently re-point them). Base44 entries win on conflict, so a project cannot repoint `base44:runtime` away from the shim. The merged map is passed as a `data:` URL, so nothing is written to disk.

Without this merge, supplying our import map would override the project's and break aliases that resolve today.

Two differences from the deployed runtime are intentional:

- **`secrets.get(name)`** reads from the environment `base44 dev` was started with. Values stored with `base44 secrets set` are deliberately not fetched, so a production secret is never copied onto a developer machine. Export the variable in your shell to exercise a function that reads it. Reading an unset secret throws, matching production.
- **`waitUntil(promise)`** has nothing to hold open locally, since the function is a long-lived server process. The promise is tracked only so a rejection is reported against the function instead of surfacing as an unhandled rejection.
