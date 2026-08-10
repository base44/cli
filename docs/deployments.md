# Deployments API (Static Sites)

**Keywords:** deployments, static site, asset manifest, hash, git hash, commit, presigned, S3, finalize, index.html sentinel, BASE44_STATIC_DEPLOYMENTS, upload

Deployments ship an app's built output addressed by the commit that produced it. This is a transport of the site module, not a module of its own, so it lives directly in `src/core/site/`: `manifest.ts` (asset walk + hashing), `static-site.ts` (the flow), `upload.ts` (presigned PUTs), with the requests and responses in the shared `api.ts` / `schema.ts` next to the legacy tar.gz upload. Today it carries the env-gated static-site lane; the create response is an ADT designed so a worker (`cf`) arm can slot in next to the static (`s3`) arm without protocol changes — that is the progressive-upgrade path for full-stack apps.

**Deploying builds — it never publishes.** A deployment is addressed by the commit that produced the build: the server derives the deployment id from `git_hash`, so one commit means one deployment and re-deploying a commit is idempotent. What production serves is decided by the platform publish flow, not by this CLI — there is no `--prod`, no promote/rollback, and no deployment list/logs surface.

## The Commit Address

`--git-hash` carries it, and there is no fallback: the flag is what selects this lane, so a deploy without one is the legacy tar.gz upload. A non-hex value is rejected by the option's `argParser` before the action runs — `isGitCommitHash()` in `src/core/utils/git.ts`, pattern `^[a-fA-F0-9]{7,64}$`, the same validation as the server.

## API Contract (app-scoped, via `getAppClient()`)

1. `POST deployments` — JSON body: `git_hash` (required) and `asset_manifest` (`{"/path": {hash, size}}`). The response is `{deployment_id, asset_uploads}` where `deployment_id` is a handle for the rest of the flow and `asset_uploads` says where the assets still owed should go, discriminated on `type`:
   - `{type: "s3", uploads: [{path, content_type, content_length, url}]}` — one presigned S3 PUT per asset still to upload, **always excluding `/index.html`** (finalize carries it).
   - `null` — nothing owed: no assets, or the build already exists (re-deploying a commit is idempotent).
2. **Asset upload — bytes never pass through the backend.** Each upload's raw file bytes are `PUT` directly to its presigned `url` with the signed `content_type` sent verbatim (the URL also signs `content_length`, so the body must be exactly the declared bytes). The URL itself is the credential, so no auth headers and never the app client. Per file: 3 attempts with exponential backoff. Concurrency defaults to `DEFAULT_UPLOAD_CONCURRENCY` (3) and is overridable with `--concurrency <n>`, capped at `MAX_UPLOAD_CONCURRENCY` (50) because each worker holds a whole file in memory.
3. `POST deployments/{id}/finalize` — multipart with exactly one file field named `index.html` carrying the index.html bytes (contentType `text/html`) — no other fields. index.html is the sentinel that completes the deployment, which is also why it never appears in the uploads. Returns `{deployment_id}`.

## Asset Manifest & Hashing

`hash = first 32 hex chars of sha256(utf8(app_id) || raw file bytes)` — see `hashAsset()` in `src/core/site/manifest.ts`. The app-id salt is a cache-poisoning defense: a tenant can only produce hash collisions with its own files.

The output directory is walked with `globby` (`**/*`, dotfiles included, symlinks not followed). `.assetsignore` at the root is honored via globby's `ignoreFiles`, which parses it with the `ignore` package — the same library wrangler uses — so it gets real gitignore semantics: anchoring, directory patterns, `**`, literal braces/extglobs, and **negation** (`!.dev.vars.example` after `.dev.vars*`). Do not translate the patterns by hand, and do not pass globby's `ignore` option alongside `ignoreFiles`: globby globs for ignore files using that option, so it would then find none and silently apply no patterns at all. `.assetsignore` itself, `wrangler.json`, and `.dev.vars` are dropped from the results by name instead. Files over 25 MiB fail with a per-file error; total file count is capped at 100,000. Manifest keys are `/`-prefixed forward-slash paths.

Content types are deliberately **not** derived client-side: the server decides each asset's Content-Type, signs it into the presigned URL, and the CLI echoes it verbatim — deriving our own value would 403 on any mapping difference.

## The Static Lane (experimental, env-gated)

Two switches, in order. **`BASE44_STATIC_DEPLOYMENTS=1`** (or `true`) is the release gate, read by `staticDeploymentsEnabled()` and consulted in exactly one place — `getSiteDeployCommand()`, which registers `--git-hash` only when it is set. **`--git-hash <commit>`** is then the runtime switch: passing it deploys through the deployments API, omitting it takes the legacy tar.gz upload. So with the gate off the flag does not exist and the lane is unreachable; with it on, the flow is chosen per invocation.

On the lane, the output directory becomes the asset manifest (index.html included — it is only ever excluded from uploads), the CLI PUTs each requested file directly to its presigned URL and finalizes with the index.html bytes; today's serving keeps working because the server stores the result the way the legacy site upload does. `--json` emits `{deploymentId, gitHash}`.

**The lane is reachable only from `base44 site deploy`** — the command the build sandbox drives, since it ships the site rather than the whole project. The fork is a plain `if` in that command's action: `options.gitHash` present → `deployStaticSite()`, absent → `deploySite()` (the tar.gz upload). There is no transport-abstraction layer between the command and the two flows; each branch owns its spinner labels and its result shape.

**Config only, no resources.** `site deploy` reads the project config through `readProjectSettings()`, not `readProjectConfig()`: it ships the built output and touches none of the project's resource files, so an invalid one must not fail it. It used to — builder apps carry entity schemas the CLI's `EntitySchema` rejects, and every publish through this lane failed with `SCHEMA_INVALID` before reaching a single asset. Commands that do consume those resources keep using `readProjectConfig()`.

`base44 deploy` is untouched by this lane: it keeps shipping the site through `deployAll()`'s legacy tar.gz step exactly as before, gate on or off. The sandbox runs `base44 site deploy -y --json --git-hash <commit>` with a scoped `apps:deploy` workspace key. When the unified deploy should adopt the lane too, that is a deliberate follow-up.

## Testing

`TestAPIServer` mocks: `mockDeploymentCreate` (captures the JSON body in `deploymentCreateRequests`; echoes whatever response shape you pass — `asset_uploads` is `{type: "s3", ...}` or `null`), `mockPresignedUpload(path)` (serves a presigned-style `PUT /presigned{path}` target, captures body/Content-Type/Authorization in `presignedUploadRequests`), `mockDeploymentFinalize` (captures multipart fields in `finalizeRequests`). Fixture: `tests/fixtures/with-site/` (static output dir); specs pass `--git-hash` to select the lane. Manifest and ignore-pattern unit tests live in `tests/core/site-manifest.spec.ts`.

## Rules (Deployments-Specific)

- **Never re-derive the asset hash** — always go through `hashAsset()` so the app-id salt stays consistent
- **Never derive an upload's Content-Type client-side** — the server signs it into the presigned URL; echo the signed value verbatim
- **Presigned PUTs carry no auth headers and never use the app client** — the URL itself is the scoped credential
- **`git_hash` is required** — a build with no commit behind it has no address and could never be published
- **Legacy behavior stays identical** when the gate is off — the tar.gz site path must not change, and nothing about the lane (flags, help text, output) may surface
