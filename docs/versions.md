# Versions

**Keywords:** versions, publish, deployment, rollback, artifact set, sha256, digest, staged upload, presigned, x-amz-checksum-sha256, entities, agents, raw payloads, provenance, commit, idempotency key, step, BASE44_VERSIONS_API, env gate, build sandbox

A **version** is one immutable thing a build produced — every frontend file, plus the entity and agent payloads the app declares. A **deployment** is a version made live at an environment. Recording one and serving one are separate acts, which is what makes a rollback a deploy of an older version rather than a second code path.

This lives in `src/core/version/`: `artifacts.ts` (the build-output walk and the raw resource reads), `api.ts` (the three HTTP calls), `publish.ts` (orchestration, and the step names behind the shared tagger in `core/errors.ts`), `gate.ts` (the env gate), `schema.ts` (wire types).

Where to build and what to collect is **not** here — it is `core/project/target.ts`, because nothing it resolves is about a version and `base44 build` needs the same answer without importing this lane.

It is **not** `src/core/site/` — see [Deployments](deployments.md). That lane ships a build to the legacy hosting API and its `deploymentId` names a Cloudflare script; this one records a version on the platform's version plane and its `deploymentId` names a deployment there. A caller that could not tell the two apart would publish by accident, so they are separate commands with separate envelope field names.

## Two hashes, never conflated

`hashAsset` in `core/site/manifest.ts` is the first 32 hex characters of `sha256(utf8(app_id) ‖ bytes)` — a **provider upload identifier**, salted so a tenant can only collide with its own files.

`ArtifactFile.digest` is a **full sha256 over the stored bytes**, streamed so a large file is never read whole. It is durable artifact identity, and the platform signs it into the upload URL. Different purpose, different moment, different value: conflating them produces an asset that uploads fine and never dedupes, or a digest check that fails on a correct file.

## The flow

`createVersion(artifacts, options)` in `api.ts` — three calls, in this order and no other, so nothing is recorded until the bytes are in place:

1. **Declare.** `POST versions` with **either** `static_bundle` (path, size, digest per file) **or** `site_worker`, plus the raw `entities` and `agents` payloads and `source_commit`. The response carries a `session_id` and one presigned PUT per declared file, in declared order.
2. **Upload.** `putPresigned` per file — the same PUT the static deployments lane uses, same ky retry policy. Each PUT sends the server's `Content-Type` **and** its `x-amz-checksum-sha256` verbatim; deriving either locally would 403 on any mapping difference. Uploads are paired with declared files **by position**, not by path: the frontend and the Worker's modules are separate namespaces, so the same name can appear in both and mean two different files.
3. **Finalize.** `POST versions/{session_id}/finalize`, no body. The set was fixed at declare, so there is nothing left for the caller to change.

The response carries `version_id` and `manifest_hash`, and no flag for "this content already existed" — the hash **is** the identity, so a caller asking whether a rebuild changed anything compares it against the last one. An existing version is not necessarily the one being served, so such a flag would be misleading anyway.

Each of the three responses is parsed through its Zod schema and a mismatch raises `SchemaValidationError` — the house pattern from [Making API calls](api-patterns.md), and the only thing keeping this client aligned with the server. There is no generated type and no shared contract fixture here, the same as every other CLI↔platform surface: a server that renames or retypes a response field fails the publish with an error naming the field, rather than propagating `undefined`. In the other direction the server's request models forbid unknown fields, so a field this client sends that the server no longer accepts is a 422.

What that does **not** catch is a change of meaning behind an unchanged shape. Nothing here does; the lane is small enough that both sides are reviewed together.

`setEnvironmentVersion(environment, versionId, options)` is one `PATCH /environments/{name}` carrying the version id and an idempotency key. The key is what makes a repeat the SAME call rather than a second publish, so the request is retried — bounded, and **only when a key is sent**, including on our own timeout, which says nothing about whether the server committed. Without a key a repeat is a deliberate redeploy and is never retried. **An environment serves one version, so making a version live is editing that pointer — there is no deployment to create.** The `Deployment` record the switch leaves behind is how the plane remembers what it prepared, returned so a caller can correlate a log line.

Nothing else is the caller's to say: the app comes from the credential, and so do the acting principal, the runtime environment variables, every artifact key, the manifest hash and the publication revision. The request models on the server forbid unknown fields, so sending one is an error rather than a silent drop.

## An app with a server of its own

`collectSiteWorker(projectRoot)` reads through `resolveFullStackBuild` — the same call `site deploy` makes — which looks for `.wrangler/deploy/config.json`, the redirect file a `@cloudflare/vite-plugin` build leaves behind. No second reader, because a second reader is a second opinion about what the framework built. `publish` and `versions create` both collect through one `collectArtifacts`, for the same reason.

A commit is a static app **or** a full-stack one, never both, and backend functions ride on either. So the two are mutually exclusive on the wire and declaring both is refused:

- **Static** — `static_bundle` is the frontend, and the platform serves it from S3. It must contain `index.html`, because any unmatched path is answered with that one file.
- **Full-stack** — `site_worker.assets` is the frontend, taken from the Worker's own `assets.directory`, and the Worker serves it. No entry file is required: its own `not_found_handling` decides. A Worker that answers every path itself declares no assets at all, which is a complete app.

`static_bundle` is not a description — the platform reads it as *serve this from S3* and hands the prefix straight to the dist service. Naming a Worker's files there would serve them raw, past every route the Worker owns. That is why they live under `site_worker` instead.

`main` is sent as the module set names it, not as the config wrote it. The platform matches the entry against the names it was sent, so a surviving `./` would name a module nothing in the set provides.

`compatibility_date`, `compatibility_flags`, each module's `type` and the whole `assets_config` ride along. They are part of the Worker's **identity** on the platform, not metadata: the same modules under a different compatibility date are a different Worker, and so are the same bytes read as `text` instead of `data`, or served with `run_worker_first` flipped. A version that dropped any of them would record two different Workers as one and could never tell them apart afterwards.

`assets_config` is wrangler's own `assets` block, field for field — `html_handling`, `not_found_handling`, `run_worker_first`, `headers`, `redirects`. A block stating none of them is sent as `null`, the same as no block at all: a bare `assets: { directory }` describes the identical Worker, and recording them apart would split one version in two.

**Nothing deploys this yet.** The platform records the Worker on the version and stores its modules, and refuses a full-stack app at admission — so today this proves the transport, not a publish.

## Why the digest is signed into the URL

The platform pins content type, content length **and** sha256 into each presigned PUT, so S3 itself rejects a body that does not hash to the declared digest. The URL is permission to write exactly one payload, once — which is what lets the server commit those bytes with a server-side copy instead of reading them back to re-hash. A frontend of any size is recorded without its bytes passing through a worker.

The practical consequence for this CLI: **send the checksum the server gave you, unchanged.** `PresignedAssetUpload.checksumSha256` is optional because the legacy static lane's URLs pin only type and length.

## Resources go up raw

`collectResources` reads `entities/` and `agents/` with `readJsonFile` and sends the parsed payloads untouched, keyed by the file's path with the schema extension stripped — `entities/Todo.jsonc` → `Todo`, `agents/support/triage.jsonc` → `support/triage`. That is the same name the platform derives from the same file.

Deliberately **not** `entityResource.readAll` / `agentResource.readAll`. The platform's own extractor and validation are authoritative, and this CLI's stricter entity schema refuses real Builder apps — which is exactly why `site deploy` reads no resources at all. Re-introducing the strict parse here would reproduce that block.

## One commit, and it is provenance rather than identity

`resolveProvenanceCommit(projectRoot, explicit?)` in `core/site/git-hash.ts` returns `undefined` rather than failing when there is no checkout. A version is identified by its **content**; the commit is recorded beside it and never hashed, so a build outside a git checkout is still a complete version.

That is the whole difference from `resolveGitHash`, whose caller addresses a deployment *by* the hash and therefore cannot go without one.

One commit, not two: an app's frontend and backend are the same app at the same source, so a version records a single `source_commit`.

## A Builder repo carries no CLI config

`resolveBuildTarget(projectRoot, overrides)` in `core/project/target.ts` fills in `npm run build` and `dist` **only when a repo has no config at all**, and **writes nothing**. The python driver it replaces used to overwrite `base44/config.jsonc` with a minimal config before building, destroying any checked-in configuration — and, for a full-stack app, its build command.

A config that is present wins, field by field, and one that omits a field still gets today's error: omitting `site.buildCommand` is a deliberate statement, and answering it with a guessed `npm run build` would change what `base44 build` does for every project that relies on that error. `requireOutputDir(target)` raises at the point of collection rather than at resolution, so a project missing both is told about its build command first — the one it hits first.

## Which step failed

A publish is three steps and they fail differently: a user's build failing, an artifact set the platform refused, and a lost publication race are three incidents with three responses. `tagStep(step, run)` attaches the step to the error through a non-enumerable symbol — the original error type, message, status code and request id all survive — and `Base44Command` writes it into the `--json` error envelope as `step`.

A callback that throws synchronously is tagged too; `run().catch(...)` would let that one escape untagged.

## Commands

**`base44 publish [--no-build] [--output-dir <dir>] [--target <name>] [--git-hash <hash>] [--concurrency <n>]`** — build, record a version, serve it. Under `--json`, stdout is a single `{environment, versionId, manifestHash, deploymentId}` document.

**`base44 versions create`** — record built output without serving it. A version can sit unpublished for as long as it likes.

**`base44 versions deploy <version-id> [--target <name>]`** — point an environment at a recorded version: no checkout, no build, no upload. Passing an older id is how a rollback is done.

`base44 build` is not part of this group and is not gated, but the lane depends on two things about it: it needs **no credential** (the publish sandbox builds before minting a key that can deploy), and it resolves its config through `resolveBuildTarget` (a Builder repo has none). What it builds and what it prints are unchanged.

The group is plural to match `agents`, `entities`, `functions`, `secrets` and `workflows` — and because `base44 version` shadowed `base44 --version` two lines above it in `--help`.

## Upload concurrency

`DEFAULT_VERSION_UPLOAD_CONCURRENCY` is 8, `MAX_VERSION_UPLOAD_CONCURRENCY` is 16. Measured on the build sandbox's pipe: at 3, a 25 500-asset app moved 27 assets/s (~109 ms per PUT, 23 KiB mean — latency-bound) and needed ~930 s of the ~450 s a build leaves, so it was SIGKILLed mid-upload every time. 8 is the rate the python driver it replaced already sustained to the same bucket; 16 failed a degraded pipe on 2026-07-02.

## What one declaration may cost

`MAX_FILE_COUNT` is 50 000, matching the server. It is a cost bound, not a guess
about app size: the platform signs one presigned URL per declared file — measured
at ~108 µs of blocking crypto each — and holds the whole declared set in Redis
until the version finalizes. At the ceiling that is ~5.4 s and ~7 MB for a single
request, which is why declaring is rate-limited far more tightly than finalizing
or deploying.

The largest frontend ever measured through the build sandbox is 25 500 assets, so
the ceiling is roughly 2x a real worst case. Raising it on one side alone only
earns a rejection after the walk.

## The env gate

The whole lane is one env var. With `BASE44_VERSIONS_API=1` (or `true`; internal gate, not user-facing yet) `base44 publish` and the `versions` group are registered; without it they are **not registered at all**, so they are absent from `--help` and typing one is an unknown command. `versionsApiEnabled()` in `core/version/gate.ts` is read in exactly one place: the registration in `program.ts`.

Deliberately **not** `BASE44_DEPLOYMENTS_API`. That one selects the legacy deployments transport for `site deploy`, and the build sandbox already sets it for that arm; one var switching both lanes would make them impossible to roll out apart.

## The automated consumer

The platform's build sandbox runs the lane in two execs and builds once:

```
base44 build --json                         # no credential in the environment
base44 publish --no-build --json \          # the key exists only for this one
  --git-hash <commit> --concurrency 8
```

Two execs because the key now carries publish authority and the build is code the repo controls, so the key is minted only after the build finishes and revoked on the way out. `--no-build` is what keeps it one build rather than two.
