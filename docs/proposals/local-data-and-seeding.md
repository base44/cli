# Proposal: Local Data Persistence & Seeding for `base44 dev`

**Keywords:** seed, seeding, persistence, local data, dev server, fixtures, reset, data pull, NeDB, state dir, worktree isolation

**Status:** Phases 1–3 implemented (see status update below)

## Status update (2026-07-13)

Phases 1–3 — persistence + lifecycle, seeding, and the remote bridge — are
implemented on branch `claude/base44-cli-seed-feature-30br0e`, **including the
programmatic `base44/seed.ts` hook**, which was pulled forward from the "Later"
phase at user request: remote access is programmable-first (`ctx.remote({ dataEnv })`
inside `seed.ts`), with `data pull`/`data dump` as the zero-code sugar. Sections
2, 6, and 7 and Open question 1 below are revised to match what shipped; the
research sections are unchanged. Contributor-facing architecture docs:
[`local-data.md`](../local-data.md).

## Problem

The `base44 dev` entity database is purely in-memory (`new Datastore()` in
`src/cli/dev/dev-server/db/database.ts`). Consequences:

- **All data is lost on every restart.** Users report re-creating test data by hand or
  writing their own scripts that pull records from the remote app and re-insert them on
  every run.
- **All data is lost on any entity-file edit.** The watcher calls `db.dropAll()` when
  anything in `entitiesDir` changes (`dev-server/main.ts`), so iterating on a schema
  wipes your working data mid-session.
- **No seed mechanism exists.** The only auto-created record is the CLI-logged-in user
  (as `admin`). Apps gated on `auth.me()` + roles + RLS (the common "private SaaS"
  shape) render empty locally, and there is no supported way to establish test users
  with roles or baseline records.
- **Not agent-friendly.** AI agents driving `base44 dev` need deterministic,
  re-runnable environments: seed once, verify UI, restart freely, run several isolated
  envs in parallel across git worktrees.

Signals: an enterprise user (role-gated, RLS-heavy app) explicitly asked for the
intended seeding/persistence pattern; another user built a personal
pull-from-remote-then-seed script and asked for it to be built in; the team direction
for `dev` is docker-style envs (detached, listable, inspectable), which requires
data isolation and durable state per env.

## Prior art (research summary)

| Platform | Persistence default | Seed format | Seed trigger | Reset | Remote bridge |
|---|---|---|---|---|---|
| Supabase | Persistent (Docker volumes); `stop --no-backup` wipes | SQL files, `[db.seed].sql_paths` globs | First start + `db reset` only | `db reset` = recreate + migrate + seed | `db dump --data-only -f seed.sql` |
| Firebase emulators | Ephemeral; snapshot opt-in | Exported snapshot dirs | `--import` at start, `--export-on-exit` | Start without `--import` | `auth:export` from prod |
| Wrangler (D1/KV) | **Persistent by default** in `.wrangler/state` (project-relative) | Plain SQL | Manual `d1 execute --local --file` | Delete state dir (always safe) | Same command with `--remote` |
| Convex | Persistent per-deployment | **Idempotent TS mutation** (`convex/init.ts`) | `convex dev --run init`, re-run anytime | Import `--replace` | First-class `export`/`import` (zip/JSONL) |
| Prisma | BYO DB | TS script in package.json | Auto after `migrate reset` (v7: explicit only) | `migrate reset` = drop + migrate + seed | — |
| PocketBase | Persistent (SQLite `pb_data/`) | JS migrations that insert records | Auto-apply on serve | Delete `pb_data/` | Copy the dir |
| Amplify Gen 2 | Cloud sandbox | TS `seed.ts` that **can create auth users** | `ampx sandbox seed` | Redeploy sandbox | — |

Strongest lessons:

1. **Persist by default; wipe explicitly.** Supabase's most-complained-about early
   behavior was data loss on restart — they inverted it. Firebase's
   ephemeral-by-default is widely worked around. Wrangler's project-relative,
   safe-to-delete state dir is the cleanest model and gives git-worktree isolation
   for free.
2. **Seeds run on first boot and on reset — never silently against existing data.**
   (Supabase, Docker `initdb.d`.) A standalone "re-seed now" command is Supabase's
   top unmet request (supabase/cli#1711); Convex has it and it's their doctrine:
   idempotent seed, safe to run anytime.
3. **Seed auth users through the real auth path, not raw inserts.** Supabase's worst
   recurring pain is seeding `auth.users` by SQL (breaks on every GoTrue change).
   Amplify ships an auth-API-compatible seed SDK instead.
4. **One canonical reset command** (`prisma migrate reset`, `migrate:fresh --seed`)
   beats a documented delete-then-restart dance — especially for agents.
5. **Remote→local snapshot is the most-requested workflow everywhere** ("develop
   against realistic data"). Convex's ID-preserving `export`/`import` with explicit
   `--replace`/`--append` is best-in-class.
6. **Agent contract:** `--json` everywhere, never prompt when non-interactive,
   destructive ops need `--force` in non-TTY, machine-discoverable instance state
   (Convex writes the deployment URL to `.env.local`; docker has `ps`/`inspect`).

In-house prior art: internal `b44 worktree` has `seedFiles` with "copy once at
creation, user-owned afterwards" semantics; the platform already has
`DataEnvironment` (`prod`/`dev`) separation, an `is_sample` record flag, and admin
`seed_entity_records` with ID remapping — the CLI feature should stay conceptually
aligned with those.

## Design

### 1. Persistence: file-backed store in a project-local state dir

Local dev state moves to a **gitignored, project-relative state dir**, sibling of the
committed `base44/` dir (mirrors `.wrangler/state`):

```
.base44/                      # gitignored, safe to delete at any time
├── dev.json                  # running-instance descriptor (see §5)
└── data/
    ├── meta.json             # { appId, seedHash, seededAt, formatVersion }
    ├── task.db               # one NeDB file per collection (append-only journal)
    ├── user.db
    └── $user.db              # private auth collection (passwords/OTP)
```

- `Database` switches from `new Datastore()` to
  `new Datastore({ filename, autoload: true })` — `@seald-io/nedb` supports file
  persistence natively, so **no new dependency** (keeps the zero-dependency
  distribution rule) and no native modules (works in npm mode and compiled binaries).
- Data now survives restarts by default. **Ephemeral is the opt-in:**
  `base44 dev --fresh` starts from a clean state (wipe + re-seed).
- **Entity-file edits no longer wipe data.** The watcher reloads schemas but keeps
  collections (NeDB is schemaless; validation applies on write). Removed entities'
  files are left on disk until `reset`. This fixes today's silent data-loss footgun.
- Keyed per app: if `.base44/data/meta.json` records a different `appId` than the
  linked app, warn and offer `--fresh` (protects against relinking a folder).
- `base44 create` templates and `base44 link` add `.base44/` to `.gitignore`.
- Compaction runs on startup (`persistence.compactDatafile`); local scale makes
  journal growth a non-issue in practice.

Because state is project-relative, **every git worktree automatically gets isolated
data** — no flags, no config. This is the data-isolation half of the docker-style
`dev` envs direction; the `dev.json` descriptor (§5) is the discovery half.

### 2. Seed source: declarative fixtures in `base44/seed/` + programmatic `base44/seed.ts`

Seeds are **both** declarative fixtures and an optional programmatic script, run in
that order (both shipped). Fixtures live in a new committed directory (configurable
as `seedDir`, default `"seed"`, alongside `entitiesDir`/`functionsDir` in
`base44/config.jsonc`):

```
base44/seed/
├── users.jsonc               # test app users, created through the real local auth path
├── Task.jsonc                # records for entity "Task" (filename = entity name, like entities/)
└── Project.jsonc
```

`users.jsonc` — solves the "role-gated app is unusable locally" problem first-class:

```jsonc
[
  { "email": "admin@example.com", "role": "admin", "password": "admin1234", "full_name": "Ada Admin" },
  { "email": "user@example.com",  "role": "user",  "password": "user1234" }
  // extra keys = custom User entity fields, validated against the merged User schema
]
```

Users are created through the same code path as local registration (password hashed
into `$user`, verified, role respected — seeding is privileged, so `role: "admin"`
is allowed). The CLI-logged-in user keeps being auto-created as admin, unchanged.

`<Entity>.jsonc` — an array of records validated against the entity schema:

```jsonc
[
  {
    "id": "seed-task-1",                    // optional; stable id => upsert on re-seed
    "title": "Ship the seed feature",
    "status": "in_progress",
    "created_by": "user@example.com"        // optional; attributes the record to a seeded user (RLS testing)
  }
]
```

Semantics:

- Applied with the **service role** (bypasses RLS — it must, or you couldn't seed
  other users' rows), after schema load, users before entities.
- Validation reuses the dev server's `Validator` (`prepareRecord` + `validate`);
  errors report file + record index. A fixture for an unknown entity is a warning,
  not a failure (glob/no-match warning, per Supabase).
- **Idempotency contract:** records with an explicit `id` are upserted; records
  without one are inserted only by a run that starts from empty (first boot, reset,
  `--replace`). The scaffolded template ships with explicit ids so agents copy the
  idempotent pattern.
- Fixtures are plain data — reviewable, diffable, and writable by agents without
  running anything. Zod schemas for both file formats live in `core/`.

Why declarative-first rather than only a TS seed script: fixtures need no extra
runtime (a `seed.ts` needs Deno, which is otherwise only required when the app has
functions), they match the existing JSONC resource convention
(`base44/entities/<Name>.jsonc`), and they cover the observed asks (test users +
baseline records + frozen remote snapshots). **Shipped change:** the programmatic
hook did not stay on the roadmap — at user request it shipped alongside fixtures,
because remote access should be **programmable-first rather than pull-only**.
`base44/seed.ts` runs after fixtures in the existing Deno runtime (exec-wrapper
pattern) with a service-role SDK client bound to the local server (`ctx.base44`)
and a remote client factory (`ctx.remote({ dataEnv })`) for the
filter/transform/generate cases fixtures can't express. Deno is required only for
this step: without it, fixtures still apply and the script step is reported as
failed. The two compose (fixtures, then script), as research predicted.

### 3. Seed lifecycle

```
base44 dev                    # data dir empty (first run / after reset / --fresh)?
  ├─ yes → apply seeds, record seedHash in meta.json
  └─ no  → leave data alone; if seed files changed since last apply,
           log a hint: "seed files changed — run `base44 dev seed` to apply"

base44 dev seed               # apply seeds NOW (server running or not)
  ├─ default: upsert-by-id (idempotent, non-destructive)
  └─ --replace: truncate seeded collections first  (non-TTY requires --force)

base44 dev reset              # THE canonical clean-slate command
  └─ wipe data dir → reload schemas → apply seeds
     (non-TTY requires --force; prints what was wiped/re-created)

base44 dev --fresh            # reset semantics fused into startup
```

Never silently re-seed existing data (lesson #2). Exactly one reset command
(lesson #4).

### 4. Working against a running server

`dev seed` / `dev reset` must work while `base44 dev` is running (agents will call
them mid-session). Two paths, one applier:

- The seed/reset logic lives in `core/` and operates on the `Database` API
  (`prepareRecord`/`validate`/insert, emitting realtime `create` events so open UIs
  update live).
- The dev server exposes **local-only admin endpoints** (`POST /_base44/dev/seed`,
  `POST /_base44/dev/reset`, `GET /_base44/dev/status`), bound to `127.0.0.1` like
  everything else and authenticated with a per-instance token written into
  `dev.json` (never accepted from the network).
- The CLI command reads `.base44/dev.json`: if a live instance is found (pid + port
  check), it calls the endpoint; otherwise it opens the datastores directly. Same
  observable result either way.

This also removes the file-lock problem of two processes opening the same NeDB
files.

### 5. Instance descriptor: `.base44/dev.json`

Written on startup, removed on shutdown; stale entries detected by pid:

```json
{
  "appId": "abc123",
  "url": "http://localhost:4400",
  "port": 4400,
  "pid": 51234,
  "dataDir": ".base44/data",
  "adminToken": "…",
  "startedAt": "2026-07-13T10:00:00Z",
  "seed": { "hash": "sha256:…", "appliedAt": "2026-07-13T10:00:01Z" }
}
```

This is the machine-discoverable state agents need ("what URL is my env on, where
are the logs") and is the natural substrate for the planned docker-style
`dev ps` / `dev inspect` / `dev logs` commands — those read the same descriptor,
this proposal just introduces it. When the default port is taken, `dev` should
auto-pick a free one (parallel worktrees) and record it here.

### 6. Remote bridge: programmable-first, `data pull` / `data dump` as sugar

The single most-requested workflow ("develop against my real app's data") and
exactly what one user hand-rolled. As shipped, the **primary** bridge is
programmatic: `base44/seed.ts` gets `ctx.remote({ dataEnv })` — an SDK client
authenticated as the CLI user against the linked remote app (`dataEnv: "dev"`
targets the dev data environment via the `X-Data-Env` header) — so
filter/transform/subset pulls are ordinary code writing through `ctx.base44`. The
zero-code commands cover the common case:

```
base44 data pull [--entity <Name> ...] [--data-env prod|dev] [--query <json>] [--limit <n>]
  └─ fetch records from the linked remote app → write seed fixtures
     (read-only against remote; never writes to the remote DB)

base44 data dump [--entity <Name> ...]
  └─ local dev data → seed fixtures
     ("I hand-crafted good data in the local UI — freeze it as the committed seed")
```

- `pull` pages the existing runtime entities list API via `getAppClient()`
  (limit/skip, page size 500), honoring the platform's `DataEnvironment` selector
  (`--data-env`, `X-Data-Env: dev` header) and an optional `--query` JSON filter.
- The API returns bare record arrays with no total count, so the reported `total`
  always equals `pulled`; when pagination stops at `--limit` with a full last page,
  the CLI notes "limit reached, more may exist".
- Ids are preserved on pull/dump, which makes the resulting fixtures idempotent by
  construction (stable-id upsert). `dump` strips NeDB's internal `_id`.
- `dump` reads a running instance via the admin export endpoint, or the NeDB files
  directly when none is running — and **never exports users in v1** (warn + skip):
  user fixtures are `users.jsonc`-shaped (roles, passwords), not
  entity-fixture-shaped.
- Default `--limit 1000` per entity — seed fixtures are for representative data,
  not full replication. A raw NDJSON snapshot mode (import/export à la Convex) can
  come later if needed.
- Sensitive data: pull is explicit and per-entity; an anonymization/subsetting story
  is deliberately out of scope for v1 (documented; see Open questions).

`dump` doubles as the answer to "Studio-made data dies on reset" (Supabase's
recurring surprise): hand-made local data becomes a committed artifact in one
command.

### 7. Command surface & conventions

New commands follow the existing factory pattern (`Base44Command`, `runTask`,
non-interactive guards) and the global `--json` contract. Final surface as shipped:

| Command | JSON stdout (shape as shipped) |
|---|---|
| `base44 dev` | unchanged default action + `--fresh` (wipe data dir before load) |
| `base44 dev status` | `dev.json` minus `adminToken`/`pid`, plus `running: bool` (`{ "running": false }` when no instance) |
| `base44 dev seed [--replace] [--force]` | `{ "applied": true, "mode": "upsert", "users": 2, "records": { "Task": { "created": 10, "updated": 2, "skipped": 0 } }, "script": { "ran": true } \| null, "warnings": [] }` |
| `base44 dev reset [--force]` | `{ "reset": true, "seeded": true, "dataDir": "…", "seed": <seed summary> \| null }` |
| `base44 data pull [--entity <names...>] [--data-env prod\|dev] [--query <json>] [--limit <n>] [--out <dir>] [--force]` | `{ "entities": { "Task": { "pulled": 120, "total": 120 } }, "wrote": ["…/seed/task.jsonc"] }` |
| `base44 data dump [--entity <names...>] [--out <dir>] [--force]` | same shape as pull; user records are never dumped (warn + skip) |

Destructive ops (`reset`, `seed --replace`, overwriting existing fixture files with
`pull`/`dump`) prompt in a TTY and require `--force` otherwise. `dev` is now a
command group with a default action, preserving plain `base44 dev` (and leaving
room for `run -d` / `ps` / `logs` / `inspect` later).

Rollout phases (1–3 shipped; `base44/seed.ts` moved up from phase 4 — see status
update):

1. **Persistence + lifecycle** — `.base44/` state dir, file-backed NeDB, `--fresh`,
   keep-data-on-schema-change, `dev.json`, `dev status`, `.gitignore` templating.
2. **Seeding** — `base44/seed/` fixtures (users + entities), auto-seed on empty,
   `dev seed`, `dev reset`, admin endpoints, scaffolded example seed in
   `base44 create` templates + docs/skill updates.
3. **Remote bridge** — `data pull` / `data dump`.
4. **Later** — programmatic `base44/seed.ts` (Deno + service-role SDK client),
   deterministic fake-data generation (seeded pRNG, drizzle-seed-style),
   anonymization on pull, snapshot import/export, docker-style env lifecycle
   commands built on `dev.json`.

Phases 1+2 are the MVP: they fix data loss and make role-gated/RLS apps usable
locally with zero remote dependency.

### How this maps to the reported problems

| Report | Answer |
|---|---|
| "Local entity DB is in-memory and clears on restart; no fixtures/persist/import path" | Persistent by default (§1); `base44/seed/` fixtures (§2); `data pull` (§6) |
| "Can't get a usable local session for a role-gated, RLS-driven SPA" | `users.jsonc` seeded through the real auth path with roles; `created_by` attribution for RLS-shaped fixtures (§2) |
| "I wrote a script that pulls from remote DB and seeds in-memory on every run" | `base44 data pull` once → committed fixtures → auto-seed (§3, §6); pull stays read-only against remote |
| Docker-style multi-agent envs (detached, ps/logs/inspect, isolation) | Project-relative state = per-worktree data isolation; `dev.json` descriptor + `dev status` as the substrate (§1, §5) |
| asServiceRole broken locally (cli#491) | Seeding runs as a real local service token; fixing the function-proxy header injection falls out of the same work and should ride along |

## Open questions

1. **Command naming — resolved (shipped):** `base44 dev seed/reset/status` under
   the `dev` group, `data pull/dump` top-level, as proposed — seeds are a local-dev
   concept, `data` touches the remote app. Still open for review: issue #285
   sketches `base44 entities record list`; if an `entities record` namespace lands,
   `data` vs `entities record` naming must be reconciled.
2. **Seed users vs production parity:** locally, seeded users can hold any role;
   there is no equivalent remote operation. Acceptable asymmetry, or should
   `users.jsonc` be explicitly documented as local-only? (Proposed: local-only,
   documented.)
3. **Pull auth semantics:** pull as the platform user via the app-scoped client —
   should it require an explicit `--include-user-data` style acknowledgment when
   entities contain user PII? (v1: no, but log the entity list and counts loudly.)
4. **`dev --fresh` vs `dev reset` overlap:** keep both (start-time flag + standalone
   command) or only the command? (Proposed: both; agents restarting an env want the
   one-shot flag.)
5. **Large datasets:** fixtures are JSONC in git; at what size do we push users
   toward a future snapshot format? (Proposed guardrail: warn above ~1 MB per
   fixture file.)
