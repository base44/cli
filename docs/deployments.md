# Deployments

**Keywords:** deployments, full-stack, Cloudflare Workers, wrangler, no_bundle, asset manifest, hash, git hash, commit, buckets, presigned, S3, upload session, finalize, .assetsignore, negation, concurrency, .wrangler/deploy/config.json, static site, BASE44_STATIC_DEPLOYMENTS, target

Deployments ship an app's built output addressed by the commit that produced it. This is a transport of the site module, not a module of its own, so it lives directly in `src/core/site/`: `deployment.ts` (the flow), `wrangler-config.ts` (artifact detection), `modules.ts` (worker module collection), `manifest.ts` (asset walk + hashing), `upload.ts` (bucket and presigned uploads), `git-hash.ts` (the commit address), with the requests and responses in the shared `api.ts` / `schema.ts` next to the legacy tar.gz upload.

**One flow, one `createDeployment()` call.** Whether the build carries a user worker changes only what that call sends, so there are no parallel full-stack and static flows to keep in step: `deployToDeployments()` checks for a worker itself, and a worker's `config` (framework builds — React Router 7, TanStack Start, Astro 6, vinext — anything built with `@cloudflare/vite-plugin`) is what makes the server answer with the `cf` arm. No worker means no `config` and the `s3` arm. That is also the progressive-upgrade path: when a static app adopts a server framework, its emitted wrangler artifact starts being detected, the create request starts carrying the worker config, and the server flips arms — one CLI protocol, zero CLI change.

Everything downstream follows from the server's answer rather than from a decision of ours: `uploadDeploymentAssets()` dispatches on the `asset_uploads` discriminant, and `finalizeDeployment()` takes whichever payload completes the deployment (worker modules, or the index.html sentinel). The only place the two shapes are spelled out is where the protocol itself differs — the finalize form in `api.ts`.

**Deploying builds — it never publishes.** A deployment is addressed by the commit that produced the build: the server derives the deployment id from `git_hash`, so one commit means one deployment and re-deploying a commit is idempotent. What production serves is decided by the platform publish flow, not by this CLI — there is no `--prod`, no promote/rollback, and no deployment list/logs surface.

## Git Hash Resolution

`resolveGitHash(projectRoot, explicit?)` — an explicit `--git-hash` wins; otherwise `git rev-parse HEAD` in the project root. No hash (not a git checkout, no flag) fails fast with guidance. A non-hex value is rejected by the option's `argParser` before the action even runs — `isGitCommitHash()` in `src/core/utils/git.ts`, pattern `^[a-fA-F0-9]{7,64}$`, the same validation as the server.

## Artifact Detection

`base44 site deploy` picks its transport from `planAppDeploy()` in `core/site/` (see [resources.md](resources.md#site-module-not-a-resource)): `deployment` (the deployments API) whenever an artifact is detected or the static gate is on, `tarball` otherwise, `none` when neither applies. A build carrying a worker is never a `tarball` — a tar.gz cannot ship one — and needs no `site.outputDirectory`, since the worker brings its own assets directory. **This lane is reachable only from `site deploy`** — `base44 deploy` ships the site through `deployAll()`'s legacy tar.gz step and has none of these flags.

`detectFullStackArtifact(projectRoot)` looks for exactly one thing: `.wrangler/deploy/config.json`, the redirect file emitted by `@cloudflare/vite-plugin` builds. Its `configPath` points at the generated `wrangler.json`, **relative to the redirect file's directory**.

A hand-authored root `wrangler.jsonc` / `wrangler.json` / `wrangler.toml` is **not** an artifact. Those are written for wrangler's own bundler, which this path never runs — so they'd fail the `no_bundle` gate below anyway, and detecting one would only hijack the deploy away from the static upload the project actually wants.

The resolved config must have `no_bundle: true`; otherwise the deploy fails with "this framework's output requires bundling; not yet supported". Only the fields a deploy acts on are declared in the schema — bindings (`kv_namespaces`, `d1_databases`, `durable_objects`, `queues`, ...) and the worker `name` are ignored outright: not forwarded, not validated, not warned about. `vars` are **not sent** — a worker's environment is the app's secrets and built-ins — and are surfaced as a warning when present, as are `_headers`/`_redirects` contents and `run_worker_first` route arrays (no server-side support yet).

## API Contract (app-scoped, via `getAppClient()`)

1. `POST deployments` — JSON body: `git_hash` (required), `config` (`main`, `compatibility_date`, `compatibility_flags`, `assets` — Cloudflare's own vocabulary: `html_handling`, `not_found_handling`, `run_worker_first` bool; **omitted entirely for a static-site deploy** — the presence of a worker config is what selects the storage target server-side), `asset_manifest` (`{"/path": {hash, size}}`). The response is `{deployment_id, session_id, asset_uploads}` where `deployment_id` is a handle for the rest of the flow (no URL, no script name), `session_id` identifies this attempt's upload session, and `asset_uploads` says where the assets still owed should go, discriminated on `type`:
   - `{type: "cf", url, jwt, buckets}` — a worker deploy: `buckets` are asset hashes grouped by Cloudflare, `url` is Cloudflare's assets upload endpoint, `jwt` is the upload-session token.
   - `{type: "s3", uploads: [{path, content_type, content_length, url}]}` — a static deploy: one presigned S3 PUT per asset still to upload, **always excluding `/index.html`** (finalize writes it).
   - `null` — nothing owed: no assets, or the build already exists (re-deploying a commit is idempotent).
2. **Asset upload — bytes never pass through the backend.** cf: for each bucket, `POST` multipart/form-data **directly to the given `url`** with `?base64=true` and `Authorization: Bearer <jwt>`; each field: name = file hash, value = base64 file bytes, contentType = the file's real MIME type. A 401/403 maps to "upload session expired — rerun deploy". Whichever bucket reply completes the manifest carries `{"result": {"jwt": "<completion token>"}}`. s3: each upload's raw file bytes are `PUT` directly to its presigned `url` with the signed `content_type` sent verbatim (the URL also signs `content_length`, so the body must be exactly the declared bytes) — the URL itself is the credential, so no auth headers and never the app client.

   Both arms are the same shape: `pMap` for concurrency and ky's own retry (`UPLOAD_RETRY`) for attempts — no hand-rolled loops, no `setTimeout` sleeps. ky retries network errors and its default status codes only (408/413/429/500/502/503/504), which is exactly what these uploads want: an expired credential (401/403) fails fast instead of burning every attempt, and a 429 waits out the server's `Retry-After` rather than a delay we invented. **The cf arm must name `methods: ["post"]`** — POST is absent from ky's default retry methods, so bucket uploads would otherwise never retry at all. ky clones a pristine request before sending, so a FormData body survives being resent.

   Concurrency defaults to `DEFAULT_UPLOAD_CONCURRENCY` (3) and is overridable with `--concurrency <n>`, capped at `MAX_UPLOAD_CONCURRENCY` (50) because each worker holds a whole file in memory.
3. `POST deployments/{id}/finalize?session_id={session_id}` — multipart; `session_id` echoes what create returned and is **required on both arms**: the deployment id derives from the commit, so two deploys of one commit share it, and the session id is what addresses this attempt's own uploads. The body shape follows which arm the request selected:
   - **worker**: field `payload` = JSON `{"completion_jwt": string|null}` plus one file field per module (name = module path, contentType `application/javascript+module` for esm / `application/source-map` for `.map`). `completion_jwt` is null when `asset_uploads` came back null — the server holds the session token that completes the asset set. Bundle cap: 50 MB.
   - **static**: exactly one file field named `index.html` carrying the index.html bytes (contentType `text/html`) — no `payload`, no modules. index.html is the sentinel that completes the deployment, which is also why it never appears in the uploads.

   Returns `{deployment_id}` for both.

## Asset Manifest & Hashing

`hash = first 32 hex chars of sha256(utf8(app_id) || raw file bytes)` — see `hashAsset()` in `src/core/site/manifest.ts`. The app-id salt is a cache-poisoning defense: a tenant can only produce hash collisions with its own files.

The assets directory (from the worker's `assets.directory` relative to the config dir, else `site.outputDirectory`) is walked with `globby` (`**/*`, dotfiles included, symlinks not followed). `.assetsignore` at the root is honored via globby's `ignoreFiles`, which parses it with the `ignore` package — the same library wrangler uses — so it gets real gitignore semantics: anchoring, directory patterns, `**`, literal braces/extglobs, and **negation** (`!.dev.vars.example` after `.dev.vars*`). Do not translate the patterns by hand, and do not pass globby's `ignore` option alongside `ignoreFiles`: globby globs for ignore files using that option, so it would then find none and silently apply no patterns at all. `.assetsignore` itself, `wrangler.json`, and `.dev.vars` are dropped from the results by name instead. Files over 25 MiB fail with a per-file error; total file count is capped at 100,000. Manifest keys are `/`-prefixed forward-slash paths.

Content types are computed per file (`getAssetContentType()`) **only for the cf arm**, where each multipart part declares its own MIME type. The s3 arm never uses them: the server decides each asset's Content-Type, signs it into the presigned URL, and the CLI echoes it verbatim — deriving our own value would 403 on any mapping difference.

## Module Collection

Entry = `main` from the wrangler config. With `no_bundle: true`, every file under the config dir matching the `rules` globs is included, excluding `wrangler.json` and `.dev.vars`, preserving relative paths as module names. `.map` files next to modules (or all of them when `upload_source_maps` is set) are included as `sourcemap`. Total module payload is capped at 40 MB client-side (the server enforces 50 MB).

## Command UX

**`base44 site deploy [--git-hash <hash>] [--concurrency <n>] [--build|--no-build]`** — the optional build step is `maybeBuildBeforeDeploy` (`--build` forces it, `--no-build` skips it, otherwise an interactive ask). Progress: "Found N static assets (M new)" → "Uploaded X of Y assets" → "Deploying worker (K modules)…" (only when there is one) → outro `Deployment <id> (commit <hash>)`. Under `--json`, stdout is a single `{deploymentId, gitHash}` document.

**"Site" is the only word for it in user-facing copy.** A site is whatever we deploy, worker or no worker, so the prompt, spinner, success line and errors say "site" and never distinguish the two — the distinction is ours, not the user's, and a deploy that reports itself differently depending on the build reads as two products. Internally the code says "worker" for the thing that may or may not be there.

**Config only, no resources.** `site deploy` reads the project config through `readProjectSettings()`, not `readProjectConfig()`: it ships the built output and touches none of the project's resource files, so an invalid one must not fail it. It used to — builder apps carry entity schemas the CLI's `EntitySchema` rejects, and every publish through this lane failed with `SCHEMA_INVALID` before reaching a single asset. Commands that do consume those resources keep using `readProjectConfig()`.

`base44 deploy` is deliberately untouched by this: it deploys the project's resources and ships the site through `deployAll()`'s legacy tar.gz step, exactly as before, and neither `--git-hash` nor `--concurrency` exists on it. Adopting the lane there is a separate decision — it would need a commit address the unified deploy has no way to take.

The primary automated consumer is the platform's build/deploy sandbox, which runs `base44 site deploy -y --json --git-hash <commit>` with a scoped `apps:deploy` workspace key — so the sandbox and a human at a terminal go through the exact same door.

## Static Sites through the Deployments API (experimental, env-gated)

A build that produced a worker is ungated — it always goes through the deployments API. The **static** lane is gated: with `BASE44_STATIC_DEPLOYMENTS=1` (or `true`; internal gate, not user-facing yet), a project with `site.outputDirectory` and **no** worker artifact deploys through the deployments API instead of the legacy tar.gz upload. `staticDeploymentsEnabled()` lives in `core/site/deploy-app.ts` and is consulted in exactly one place — `planAppDeploy()` — so the gate decides a transport, never a flag's existence.

The commit comes from `--git-hash` when passed, otherwise `git rev-parse HEAD`; on the lane with neither available the deploy fails asking for the flag, rather than silently falling back to the tar.gz upload — a deployment is addressed by the commit that produced it, so a build with no address could never be published.

On the lane, the output directory becomes the asset manifest (index.html included — it is only ever excluded from uploads), and the create request carries **no `config`**, which the server answers with the `s3` arm. The CLI PUTs each requested file directly to its presigned URL and finalizes with the index.html bytes; today's serving keeps working because the server stores the result the way the legacy site upload does. Same flow, same commands, same `--git-hash` addressing, same `--json` output.

With the gate off, a static site takes the legacy tar.gz path unchanged.

## Testing

`TestAPIServer` mocks: `mockDeploymentCreate` (captures the JSON body in `deploymentCreateRequests`; echoes whatever response shape you pass — `asset_uploads` selects the arm: `{type: "cf", ...}`, `{type: "s3", ...}` or `null`), `mockAssetUpload` (serves a Cloudflare-style `POST /cf-assets/upload` target, captures the Authorization header, `?base64=true` query and multipart fields in `assetUploadRequests`, responds 201 with the completion jwt), `mockPresignedUpload(path)` (serves a presigned-style `PUT /presigned{path}` target, captures body/Content-Type/Authorization in `presignedUploadRequests`), `mockDeploymentFinalize` (captures multipart fields in `finalizeRequests` and query strings in `finalizeQueries`). Fixtures: `tests/fixtures/fullstack-project/` (redirect file + `build/server` worker + `build/client` assets with `.assetsignore`) and `tests/fixtures/with-site/` (static output dir) — not git repos, so specs pass `--git-hash`. Unit tests live in `tests/core/site-*.spec.ts`.

## Rules (Deployments-Specific)

- **Never re-derive the asset hash** — always go through `hashAsset()` so the app-id salt stays consistent
- **Asset bytes never pass through the backend** — cf buckets POST directly to Cloudflare authorized by the upload-session jwt (and never through the app client, which would leak app auth); s3 PUTs go directly to the presigned URLs, where the URL itself is the credential and no auth header may be sent
- **Never derive an upload's Content-Type on the s3 arm** — the server signs it into the presigned URL; echo the signed value verbatim
- **Never hand-roll upload retry or backoff** — configure ky's `retry`; both arms share `UPLOAD_RETRY`, and a non-default method (POST) must be named in `methods`
- **Never hand-roll `.assetsignore` matching** — let globby's `ignoreFiles` parse it, and never pass `ignore` alongside it
- **`git_hash` is required** — a build with no commit behind it has no address and could never be published
- **One `createDeployment()` call site** — a worker changes its parameters, never the flow around it; do not fork the code path on "full-stack vs static"
- **Say "site" to the user** — never "full-stack app"; the presence of a worker is not a distinction user-facing copy makes
- **Legacy behavior stays identical** when no worker artifact exists and the static gate is off — the tar.gz site path must not change
