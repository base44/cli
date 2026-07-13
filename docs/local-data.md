# Local Data & Seeding

**Keywords:** seed, seeding, fixtures, persistence, NeDB, .base44, state dir, dev.json, meta.json, applySeeds, readSeedFiles, SeedSummary, seed hash, admin endpoints, x-base44-dev-admin, seed.ts, runSeedScript, data pull, data dump, dev seed, dev reset, dev status, --fresh, ephemeral dev server, service role

`base44 dev` persists entity data in file-backed NeDB collections under a gitignored, project-relative `.base44/` dir, and seeds it from `base44/seed/*.jsonc` fixtures plus an optional programmatic `base44/seed.ts`. Design rationale: [proposals/local-data-and-seeding.md](proposals/local-data-and-seeding.md).

## Module Map

| Module | Owns |
|---|---|
| `src/core/local-state/` | `.base44/` path helpers; Zod schemas + read/write for `meta.json` and `dev.json` (pid-based stale detection); local dev JWTs (`createServiceToken`) |
| `src/core/resources/seed/` | Fixture file formats (Zod), `readSeedFiles()`, seed hash, `SeedSummary`/`DevResetResult` shapes, `normalizeSeedName()` |
| `src/core/seed-script/` | `runSeedScript()` — spawns Deno on the seed wrapper (test seams: `spawnImpl`, `wrapperPath`; `seedScript` test override) |
| `deno-runtime/seed.ts` | Deno wrapper: builds the script's `ctx` from env vars and calls its default export |
| `src/cli/dev/dev-server/db/seed.ts` | `applySeeds()` — applies users + entity fixtures against the `Database` |
| `src/cli/dev/dev-server/routes/admin-router.ts` | `/_base44/dev/*` admin endpoints behind the per-instance token |
| `src/cli/dev/seed-script-step.ts` | Runs `seed.ts` after fixtures, records the outcome on the summary (never throws) |
| `src/cli/commands/dev/` | `dev` group: default server action + `status`/`seed`/`reset`; `seed-shared.ts` holds the live/offline duality helpers |
| `src/cli/commands/data/` | `data pull` (remote → fixtures) and `data dump` (local → fixtures) |

The layering rule holds: `core/` owns formats, paths, hashing, and the script runner; anything touching the `Database` class stays in `cli/` (dev-server).

## State Dir Layout

```
.base44/                # gitignored, safe to delete
├── dev.json            # instance descriptor while a dev server runs (incl. adminToken)
└── data/
    ├── meta.json       # { formatVersion: 1, appId, seed: { hash, appliedAt } | null }
    ├── task.db         # one NeDB file per collection
    └── $user.db        # private auth collection (passwords)
```

Path helpers: `getStateDir` / `getDataDir` / `getDevJsonPath` / `getMetaJsonPath` in `src/core/local-state/paths.ts`. `readDevInstance()` returns `null` (and deletes the file) when the descriptor is invalid or its pid is dead.

## Lifecycle

**Startup** (`createDevServer` in `src/cli/dev/dev-server/main.ts`):

1. `--fresh` deletes the data dir. A data dir owned by a different `appId` refuses to start (hint: `--fresh`).
2. Auto-seed happens **only when the data dir is new** (no valid `meta.json`): fixtures apply in `replace` mode. Otherwise a changed seed hash just logs a "run `base44 dev seed`" hint.
3. `meta.json` is written; `dev.json` is written after listen and deleted on graceful shutdown.
4. The `seed.ts` step runs **after listen** (it talks to the server over HTTP); startup seed failures warn but never crash the server.
5. Entity-file changes reload schemas only (`db.reloadSchemas`) — data is preserved.

**Seed modes** (`applySeeds`): users are always upserted by email through the same building blocks as local registration (the CLI login user survives every mode). Entity records:

- `upsert` (default for `dev seed`): upsert-by-id; id-less records are skipped; never deletes.
- `replace` (first boot, `--fresh`, `dev reset`, `dev seed --replace`): truncate each seeded collection, then insert everything.

Fixture filenames resolve to entities by normalized comparison (case/`-`/`_`-insensitive, so `team-member.jsonc` → `TeamMember`); `users.jsonc` is reserved. Records are validated and stamped (`id`, `created_by`, dates) exactly like the entity POST route, as service role (bypasses RLS/FLS).

**Live vs offline — one implementation.** `dev seed`, `dev reset`, and `data dump` read `dev.json` (`src/cli/commands/dev/seed-shared.ts`):

- Live instance → call its admin endpoints.
- No instance, no `seed.ts` → open the NeDB files directly (`openOfflineDatabase`).
- No instance, `seed.ts` present → `withTempDevInstance()` boots an **ephemeral** internal dev server (random port, `ephemeral: true` — no `dev.json`, no startup auto-seed, `serveCommand` stripped), drives the same admin endpoints, then shuts down.

## Admin Endpoints

Mounted at `/_base44/dev` (`admin-router.ts`); every route requires the `x-base44-dev-admin` header matching the token in `dev.json`:

| Endpoint | Returns |
|---|---|
| `GET /status` | `{ appId, port, startedAt, seed, collections: {name: count} }` |
| `POST /seed` body `{ mode }` | `SeedSummary` |
| `POST /reset` | `DevResetResult` |
| `GET /export?entities=a,b` | `{ collections: { Name: records[] } }` (`data dump` live path) |

## seed.ts Runner Contract

`runSeedScript()` (`src/core/seed-script/run-script.ts`) copies `deno-runtime/seed.ts` to a temp file (Deno blocks `npm:` specifiers under `node_modules`) and spawns `deno run --allow-all`. The wrapper builds:

- `ctx.base44` — SDK client bound to the local dev server with a service-subject JWT in the plain token field (the server resolves `server@server.com` to the service principal; bypasses RLS/FLS)
- `ctx.remote({ dataEnv? })` — SDK client factory for the linked remote app as the CLI user; `dataEnv: "dev"` adds the `X-Data-Env: dev` header. Throws the recorded reason when remote credentials were unavailable.
- `ctx.log(msg)` — stderr logger

| Env var | Value |
|---|---|
| `SCRIPT_PATH` | `file://` URL of the project's `base44/seed.ts` |
| `BASE44_APP_ID` | App id |
| `BASE44_LOCAL_URL` | Local dev server base URL |
| `BASE44_LOCAL_SERVICE_TOKEN` | Local service-role JWT |
| `BASE44_ACCESS_TOKEN` | Remote app-user token (may be empty) |
| `BASE44_APP_BASE_URL` | Remote app's published URL (may be empty) |
| `BASE44_REMOTE_ERROR` | Why remote credentials are missing, if they are |

The child's stdout **and** stderr are piped to the CLI's stderr, so script output can never corrupt `--json` stdout. Deno is required only for this step: without it, fixtures still apply, the summary reports `script: { ran: false }` plus a warning, and `dev seed`/`dev reset` exit non-zero.

## Extending

- **New fixture field** (like `created_by`): add it to `SeedRecordSchema` in `src/core/resources/seed/schema.ts` (structure) and handle it in `applyRecordsFixture` in `src/cli/dev/dev-server/db/seed.ts` (behavior). Per-record entity validation stays at apply time.
- **New admin endpoint**: add the route in `admin-router.ts` **inside** the token middleware, a typed callback on `AdminRouterDeps`, its implementation in `dev-server/main.ts`, and a Zod-parsed client call in `seed-shared.ts` (`callAdminEndpoint`) so live, offline, and ephemeral callers all get it.
- **New `ctx` capability for seed.ts**: extend the wrapper (`deno-runtime/seed.ts`), pass host-side values through env vars in `run-script.ts`, and register new SDK clients in the wrapper's `clients` array so cleanup lets the process exit.

## Rules

1. **Seed summary/reset shapes are frozen Zod contracts** (`SeedSummarySchema`, `DevResetResultSchema` in `src/core/resources/seed/schema.ts`) — returned by the applier and the admin endpoints, and printed as `--json` stdout. Change them deliberately and everywhere at once.
2. **Never write to stdout from the runner or the wrapper** — script output goes to stderr (`ctx.log`, piped child stdio); stdout is reserved for the CLI's `--json` document.
3. **Admin routes stay behind the token middleware** — new endpoints go inside `createAdminRouter` after the `x-base44-dev-admin` check; never accept the token from anywhere but that header.
4. **core/ must not import cli/** — the `Database`-touching applier lives in `src/cli/dev/dev-server/db/seed.ts`; parsing, validation, and hashing stay in `src/core/resources/seed/`.
5. **Never silently re-seed existing data** — auto-apply happens only when the data dir is new; everything else is an explicit command.
6. **Users are special** — seeded via `users.jsonc` through the registration building blocks, upserted by email in every mode, never deleted (the CLI login user always survives), and never exported by `data dump`.
