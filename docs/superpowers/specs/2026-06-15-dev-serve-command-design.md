# Design: Run the frontend `serveCommand` from `base44 dev`

## Goal

`base44 dev` should start the backend dev server **and** the project's frontend dev
server (`site.serveCommand`, e.g. `npm run dev` → vite) as one foreground process. The
frontend is launched with the Base44 env vars injected so it points at the local backend.
Today the user needs two terminals (`base44 dev` + `npm run dev`); after this change a
single `base44 dev` runs both.

## Background / current state

- `site.serveCommand` already exists in the config schema
  (`packages/cli/src/core/project/schema.ts:17`, `z.string().optional()`) and is exposed
  via `readProjectConfig()` on `project.site.serveCommand` — but **nothing reads it today**.
  In a scaffolded app it defaults to `"npm run dev"`.
- `devAction` (`packages/cli/src/cli/commands/dev.ts`) calls `createDevServer`, gets back
  `resolvedPort`, then writes `.env.local` with `VITE_BASE44_APP_ID` and
  `VITE_BASE44_APP_BASE_URL=http://localhost:<port>` so the frontend's `@base44/vite-plugin`
  targets the dev server. The CLI stays alive because `createDevServer` opens long-lived
  handles (HTTP listening socket, socket.io, file watcher).
- `createDevServer` (`packages/cli/src/cli/dev/dev-server/main.ts`) is already the single
  owner of every dev subprocess: `FunctionManager` (deno subprocesses), socket.io, the
  config file watcher, plus the `SIGINT`/`SIGTERM` handlers and the `shutdown()` closure.
- `FunctionManager` (`packages/cli/src/cli/dev/dev-server/function-manager.ts`) is the
  precedent for managing a long-running, streamed subprocess: raw `child_process.spawn`
  with `stdio: ["pipe","pipe","pipe"]`, line-by-line logging, and a kill path that uses
  `taskkill /pid <pid> /T /F` on Windows and `proc.kill()` elsewhere.
- `execa` (`^9.6.1`) is a dependency, used for **one-shot** commands (install/build in
  scaffold, version-check).

## Decisions

| Question | Decision |
| --- | --- |
| Trigger | **Auto-run** the serveCommand when present; `--no-serve` opts out. |
| Output | **Both streams tagged** — `[backend]` and `[frontend]` prefixes in distinct colors (concurrently-style). Accepts that vite's screen-clear/redraw is lost. |
| Env vars | **Inject only** into the spawned frontend by default. **Do not** write `.env.local`. |
| `.env.local` | Only written when `--write-env` is passed (force-write/overwrite). Never written otherwise — including under `--no-serve`. |
| Flag name | `--write-env`. |
| Frontend exits unexpectedly | **Tear down everything** (shut down backend, exit non-zero). |
| No serveCommand in config | Backend-only, **silently**. |
| serveCommand fails to spawn | Clear error + tear down. |
| Subprocess primitive | `child_process.spawn` (matches `FunctionManager`; needed for process-group kill). |
| Orchestration | `devAction` = policy (flags, appId, `--write-env` file). `createDevServer` = mechanism/lifecycle (env injection, spawn, teardown). |

## Architecture

### New module: `ServeRunner` — `packages/cli/src/cli/dev/dev-server/serve-runner.ts`

A sibling of `FunctionManager`. Owns exactly one child process (the frontend dev server).

- **Constructor:** `{ command: string; cwd: string; env: Record<string, string>; logger }`.
- **`start()`** — `spawn(command, { cwd, shell: true, detached: <non-Windows>, env: { ...process.env, ...env }, stdio: ["inherit", "pipe", "pipe"] })`.
  - `shell: true` so a string like `"npm run dev"` parses.
  - `detached: true` on non-Windows so the child leads its own process group, enabling
    tree-kill of the `npm → vite` grandchild.
  - On spawn `error` (e.g. command not found), reject/throw so `devAction` can fail clearly.
- **Output** — pipe stdout/stderr, split on newlines, emit each line through a logger that
  prepends a colored `[frontend]` tag.
- **`stop()`** — non-Windows: `process.kill(-pid, "SIGTERM")` to kill the whole group;
  Windows: `taskkill /pid <pid> /T /F` (reusing `FunctionManager`'s approach).
- **`onExit(cb)`** — fires when the child exits on its own (distinct from `stop()`-initiated
  exit), used to wire tear-down-everything.

### Tagged output

Introduce a small labeled-logger helper so both sources are attributed:

- Backend dev logs (`createDevLogger` / `options.log` "Loaded …" lines) render as `[backend] …`.
- Frontend lines render as `[frontend] …`.
- Distinct colors, e.g. backend = `theme.colors.base44Orange`, frontend = `theme.colors.links`.

Trade-off (accepted): line-buffering + prefixing breaks vite's interactive redraw / screen
clearing. Vite still prints its `Local: http://localhost:<vitePort>/` line, which is what the
user opens.

### Wiring in `createDevServer` (`main.ts`)

- Add optional `serve?: { command: string; appId: string }` to `DevServerOptions`.
- After the HTTP server is listening and `resolvedPort` is known, if `serve` is present:
  - Build env: `VITE_BASE44_APP_ID = serve.appId`,
    `VITE_BASE44_APP_BASE_URL = http://localhost:<resolvedPort>`.
  - Create + `start()` the `ServeRunner`.
- Add `serveRunner.stop()` to the existing `shutdown()` closure (so `SIGINT`/`SIGTERM` tears
  it down alongside functions, socket.io, watcher).
- Wire `serveRunner.onExit(() => { shutdown(); process.exit(1); })` for tear-down-everything.

### Policy in `devAction` (`dev.ts`)

- New command options:
  - `--no-serve` (commander negates a default-true `serve` boolean).
  - `--write-env` (default false).
- Flow:
  1. `loadResources()` already returns `project`; read `project.site?.serveCommand`.
  2. If `serveCommand` present **and** serve not disabled → resolve `appId` via
     `initAppContext()`, pass `serve: { command, appId }` into `createDevServer`.
  3. If `serveCommand` absent → backend-only, no warning.
  4. If `--write-env` → force-write `.env.local` with the resolved `appId` and port
     (overwrite if present). This is the only path that writes the file.
  5. Outro: keep the backend URL line, now secondary; the `[frontend]` vite URL is the one
     the user opens (vite's chosen port isn't known ahead of time, so we let vite print it).
- `writeEnvLocalIfMissing` is replaced by a `--write-env`-gated force-write (rename to
  reflect it always writes when called).

## Error handling

- **Spawn failure** (serveCommand set but command not found / non-spawnable): surface a clear
  error and tear down. Reuse the project's error patterns (`CLIExitError` family); no
  `process.exit` directly except the deliberate tear-down-everything path.
- **Unexpected frontend exit** (any self-initiated exit while running): `onExit` → `shutdown()`
  → `process.exit(1)`.
- **Distinguishing stop vs crash:** `stop()` sets an internal flag so the `exit` handler does
  not treat an intentional shutdown as a crash (mirrors `FunctionManager`'s `code === null`
  reasoning).

## Testing (testkit, integration)

- serveCommand is spawned with both env vars present — fake serveCommand:
  `node -e "console.log(process.env.VITE_BASE44_APP_ID, process.env.VITE_BASE44_APP_BASE_URL)"`.
- `--no-serve` → no child spawned; `.env.local` **not** written.
- default run → `.env.local` **not** written.
- `--write-env` → `.env.local` written/overwritten with resolved values.
- frontend non-zero / unexpected exit → backend torn down, process exits non-zero.
- absent serveCommand → backend-only, no warning, no child.
- spawn failure (bogus command) → clear error.
- output lines from both processes carry the correct `[backend]`/`[frontend]` prefix.

## Out of scope

- Detecting / surfacing vite's chosen port as the headline URL.
- Restart-on-crash / supervision of the frontend (we tear down instead).
- Running `installCommand`/`buildCommand` as part of `dev`.
- TUI multiplexing / split panes.
