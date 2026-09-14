# Versions

**Keywords:** versions, publish, deployment, rollback, artifact set, sha256, digest, staged upload, presigned, x-amz-checksum-sha256, entities, agents, raw payloads, provenance, commit, idempotency key, step, BASE44_VERSIONS_API, env gate, build sandbox

A **version** is one immutable thing a build produced — every frontend file, plus the entity and agent payloads the app declares. A **deployment** is a version made live at an environment. Recording one and serving one are separate acts, which is what makes a rollback a deploy of an older version rather than a second code path.

This lives in `src/core/version/`: `artifacts.ts` (the build-output walk and the raw resource reads), `api.ts` (the three HTTP calls), `publish.ts` (orchestration and step tagging), `project.ts` (where to build and what to publish), `gate.ts` (the env gate), `schema.ts` (wire types).

It is **not** `src/core/site/` — see [Deployments](deployments.md). That lane ships a build to the legacy hosting API and its `deploymentId` names a Cloudflare script; this one records a version on the platform's version plane and its `deploymentId` names a deployment there. A caller that could not tell the two apart would publish by accident, so they are separate commands with separate envelope field names.

## Two hashes, never conflated

`hashAsset` in `core/site/manifest.ts` is the first 32 hex characters of `sha256(utf8(app_id) ‖ bytes)` — a **provider upload identifier**, salted so a tenant can only collide with its own files.

`ArtifactFile.digest` is a **full sha256 over the stored bytes**, streamed so a large file is never read whole. It is durable artifact identity, and the platform signs it into the upload URL. Different purpose, different moment, different value: conflating them produces an asset that uploads fine and never dedupes, or a digest check that fails on a correct file.

## The flow

`createVersion(artifacts, options)` in `api.ts` — three calls, in this order and no other, so nothing is recorded until the bytes are in place:

1. **Declare.** `POST versions` with `static_bundle` (path, size, digest per file), the raw `entities` and `agents` payloads, and `source_commit`. The response carries a `session_id` and one presigned PUT per file.
2. **Upload.** `uploadPresignedAssets` — the same function the static deployments lane uses, same `pMap` concurrency and same ky retry policy. Each PUT sends the server's `Content-Type` **and** its `x-amz-checksum-sha256` verbatim; deriving either locally would 403 on any mapping difference.
3. **Finalize.** `POST versions/{session_id}/finalize`, no body. The set was fixed at declare, so there is nothing left for the caller to change. The response says whether the content deduplicated to a version that already existed.

`deployVersion(versionId, options)` is one POST carrying a target name and an idempotency key. Nothing else is the caller's to say: the app comes from the credential, and so do the acting principal, the runtime environment variables, every artifact key, the manifest hash and the publication revision. The request models on the server forbid unknown fields, so sending one is an error rather than a silent drop.

## Why the digest is signed into the URL

The platform pins content type, content length **and** sha256 into each presigned PUT, so S3 itself rejects a body that does not hash to the declared digest. The URL is permission to write exactly one payload, once — which is what lets the server commit those bytes with a server-side copy instead of reading them back to re-hash. A frontend of any size is recorded without its bytes passing through a worker.

The practical consequence for this CLI: **send the checksum the server gave you, unchanged.** `PresignedAssetUpload.checksumSha256` is optional because the legacy static lane's URLs pin only type and length.

## Resources go up raw

`collectResources` reads `entities/` and `agents/` with `readJsonFile` and sends the parsed payloads untouched, keyed by the file's path with the schema extension stripped — `entities/Todo.jsonc` → `Todo`, `agents/support/triage.jsonc` → `support/triage`. That is the same name the platform derives from the same file.

Deliberately **not** `entityResource.readAll` / `agentResource.readAll`. The platform's own extractor and validation are authoritative, and this CLI's stricter entity schema refuses real Builder apps — which is exactly why `site deploy` reads no resources at all. Re-introducing the strict parse here would reproduce that block.

## The commit is provenance, not identity

`resolveProvenanceCommit(projectRoot, explicit?)` in `core/site/git-hash.ts` returns `undefined` rather than failing when there is no checkout. A version is identified by its **content**; the commit is recorded beside it and never hashed, so a build outside a git checkout is still a complete version.

That is the whole difference from `resolveGitHash`, whose caller addresses a deployment *by* the hash and therefore cannot go without one.

## A Builder repo carries no CLI config

`resolvePublishTarget(projectRoot, overrides)` in `project.ts` fills in `npm run build` and `dist` **only when a repo has no config at all**, and **writes nothing**. The python driver it replaces used to overwrite `base44/config.jsonc` with a minimal config before building, destroying any checked-in configuration — and, for a full-stack app, its build command.

A config that is present wins, field by field, and one that omits a field still gets today's error: omitting `site.buildCommand` is a deliberate statement, and answering it with a guessed `npm run build` would change what `base44 build` does for every project that relies on that error. `requireOutputDir(target)` raises at the point of collection rather than at resolution, so a project missing both is told about its build command first — the one it hits first.

## Which step failed

A publish is three steps and they fail differently: a user's build failing, an artifact set the platform refused, and a lost publication race are three incidents with three responses. `tagStep(step, run)` attaches the step to the error through a non-enumerable symbol — the original error type, message, status code and request id all survive — and `Base44Command` writes it into the `--json` error envelope as `step`.

A callback that throws synchronously is tagged too; `run().catch(...)` would let that one escape untagged.

## Commands

**`base44 publish [--no-build] [--output-dir <dir>] [--target <name>] [--git-hash <hash>] [--concurrency <n>]`** — build, record a version, serve it. Under `--json`, stdout is a single `{versionId, manifestHash, deduplicated, deploymentId, revision}` document.

**`base44 versions create`** — record built output without serving it. A version can sit unpublished for as long as it likes.

**`base44 versions deploy <version-id> [--target <name>]`** — serve a recorded version: no checkout, no build, no upload. Passing an older id is how a rollback is done.

`base44 build` is not part of this group and is not gated, but the lane depends on two things about it: it needs **no credential** (the publish sandbox builds before minting a key that can deploy), and it resolves its config through `resolvePublishTarget` (a Builder repo has none). What it builds and what it prints are unchanged.

The group is plural to match `agents`, `entities`, `functions`, `secrets` and `workflows` — and because `base44 version` shadowed `base44 --version` two lines above it in `--help`.

## Upload concurrency

`DEFAULT_VERSION_UPLOAD_CONCURRENCY` is 8, `MAX_VERSION_UPLOAD_CONCURRENCY` is 16. Measured on the build sandbox's pipe: at 3, a 25 500-asset app moved 27 assets/s (~109 ms per PUT, 23 KiB mean — latency-bound) and needed ~930 s of the ~450 s a build leaves, so it was SIGKILLed mid-upload every time. 8 is the rate the python driver it replaced already sustained to the same bucket; 16 failed a degraded pipe on 2026-07-02.

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
