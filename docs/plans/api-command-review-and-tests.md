# `base44 api` — review in plain words, and a command test plan

PR: https://github.com/base44/cli/pull/663 (commit 28ab1cc). Spec used for the tests: production, 491 operations, cached at `~/.base44/cache/app.base44.com/openapi.json` on 2026-10-15.

## Part 1 — Review, plain words

Fix before merge:

1. **Calls give up after 10 seconds.** `api fetch` and the spec download use the HTTP client with no timeout, so the library default of 10 s applies. The built-in commands for the same endpoints wait 30–60 s or forever (`secrets set` waits forever). So `api fetch POST .../secrets` can fail where `secrets set` works. Fix: pass `timeout: false` for the user's call and a long timeout for the spec download.
2. **A bad cache file breaks every `api` command for an hour.** If the cached spec cannot be parsed, the CLI throws instead of downloading again. Also, the file is written in place, not via a temp file and rename. So two `api` commands started at the same time on a cold cache can leave a half-written file. The user then sees "The API spec from the server is not valid JSON" for up to an hour, and the message blames the server. Fix: a parse failure of the cache means "download again"; write to a temp file and rename.
3. **A call without `--body` can hang forever.** For anything that is not GET or HEAD, if no `--body` is given and stdin is not a terminal, the CLI reads stdin until it closes. Agent harnesses and CI often keep stdin open, so `api fetch DELETE ...` never sends and never exits. Fix: only read stdin when `--body @-` is given, or at least never for DELETE.

Should fix:

4. **Failed calls send the request body to PostHog.** When a call fails, the error reporter already attaches the request body, the response body and the command arguments. With `api fetch` that means any endpoint, for example a secret value sent to `POST .../secrets` that got a 422. Fix: don't attach bodies for `api fetch` errors.
5. **Shared path parameters are missed.** OpenAPI lets a path declare `parameters` once for all its methods. The code only reads parameters on the operation itself, so those are missing from `--help` and from search. Today's production spec puts everything on the operation, so this is latent, not visible.
6. **`--json` can print non-JSON.** The repo rule says `--json` makes stdout one JSON document. `api fetch` prints a non-JSON response (CSV, HTML error page) as raw text, and `api fetch --help` with no path prints usage text. Both break `JSON.parse` for a caller.
7. **On an HTTP error the server's reply is lost.** A non-2xx becomes an error message with a reformatted summary. For a curl-like tool, agents want the status and the raw body. Suggest: print the body and exit non-zero.

Cleanup:

8. `grep --area` checks the area in one place and then filters by area again inside `grepSpec`. Pass the filtered list in instead.
9. `formatJson` repeats `toJsonStdout` from `cli/utils/json.ts`. Extend the shared one.
10. When `--read-only` or `--help` can't find the path, the hint says "run api search". With a stale cache the right hint is `--refresh`.

Found while testing (new, see Part 2):

11. **The HTTP method is not searchable.** `search "delete app"` puts `DELETE /api/apps/{app_id}` at rank 4. The index has path, summary, description and parameters, but not the method. Add `method` as a field.
12. **Tiny words produce junk results.** `search "who am i"` returns five unrelated operations because the prefix match on `i` hits "incentives", "invite", "import". Drop tokens shorter than 3 characters (or require a minimum absolute score) and return `[]`.
13. **Catalog samples are mostly "Delete …".** Operations are sorted by `METHOD path`, and DELETE sorts before GET and POST, so the 3 sample summaries per area start with the destructive ones. Sort samples by GET first, or by path only.
14. **`list apps` ranks the list endpoint third.** `GET /api/apps` has only two path tokens, so endpoints whose path contains "list" (`sandbox-bridge/list_directory`, `members/list`) win on the path boost of 8. Lower the path boost, or boost summary above path.

## Part 2 — Command test plan

Each row has the command, the single answer we want, and what the branch gives today. "Pass" means the wanted answer is rank 1 (search), or the output matches exactly (everything else).

### `api search` — exactly one wanted answer

| # | Command | Wanted (rank 1) | Today |
|---|---|---|---|
| S1 | `base44 api search failed workflow runs` | `GET /api/apps/{app_id}/workflows/runs` | **Fail** — rank 3; rank 1 is "Analyze a failed workflow run" |
| S2 | `base44 api search workflow runs` | `GET /api/apps/{app_id}/workflows/runs` | **Fail** — rank 2; rank 1 is "List runs for a workflow" (per workflow) |
| S3 | `base44 api search list secrets` | `GET /api/apps/{app_id}/secrets` | Pass |
| S4 | `base44 api search set secret` | `POST /api/apps/{app_id}/secrets` | Pass |
| S5 | `base44 api search delete app` | `DELETE /api/apps/{app_id}` | **Fail** — rank 4 (method not indexed) |
| S6 | `base44 api search list apps` | `GET /api/apps` | **Fail** — rank 3 |
| S7 | `base44 api search domain availability` | `GET .../custom-domains/availability` | Pass |
| S8 | `base44 api search function logs` | `GET .../functions-mgmt/{function_name}/logs` | Pass |
| S9 | `base44 api search invite collaborator` | `POST .../users/invite-users` | Pass |
| S10 | `base44 api search deploy app` | `POST /api/apps/{app_id}/deploy` | Pass |
| S11 | `base44 api search list checkpoints` | `GET .../app-checkpoints` | Pass |
| S12 | `base44 api search restore app from trash` | `POST /api/apps-trash/{app_id}/restore` | Pass |
| S13 | `base44 api search github connection` | `GET .../github/connection` | Pass |
| S14 | `base44 api search email templates` | `GET /api/apps/{app_id}/emails` | Pass |
| S15 | `base44 api search deprovision user` | `DELETE .../users/provisions` | Pass |
| S16 | `base44 api search create branch` | `POST .../branches` | Pass |
| S17 | `base44 api search rename asset` | `PATCH .../assets/{asset_id}` | Pass |
| S18 | `base44 api search sso settings` | `GET .../sso/settings` | Pass |
| S19 | `base44 api search get session recording settings` | `GET /api/session-recordings/apps/{app_id}/recording-settings` | Not run yet (`session recording` alone gives the PATCH first, which is fair) |
| S20 | `base44 api search test run report` | `GET .../testing-agent/analysis/{execution_id}` | Pass |
| S21 | `base44 api search list entity records` | `GET .../entities/{entity_name}/v2/list` | Pass |
| S22 | `base44 api search export source code` | `GET .../coding/export-to-zip` | Pass |
| S23 | `base44 api search undeploy` | `POST /api/apps/{app_id}/undeploy` ("Unpublish app") | Pass |
| S24 | `base44 api search app logo` | `POST .../metadata/generate-logo` or `update-logo` | Pass (both are ranks 1–2) |
| S25 | `base44 api search secrets --read-only` | exactly one result: `GET .../secrets` | Pass |
| S26 | `base44 api search whoami` | `[]` (no such endpoint) | Pass |
| S27 | `base44 api search who am i` | `[]` | **Fail** — 5 unrelated results |
| S28 | `base44 api search zebra` | `[]` | Pass (unit test) |

Score today: 20 pass, 5 fail, 1 not run, out of 26 run.

### `api grep`

| # | Command | Wanted | Today |
|---|---|---|---|
| G1 | `base44 api grep webhook_secret` | exactly one hit: schema `ConfigureLiveKeysRequest` | Pass |
| G2 | `base44 api grep page_size` | exactly one hit: schema `MembersListRequest` | Pass |
| G3 | `base44 api grep -i cron --limit 5` | workflow schemas with `cron_expression` | Pass (4 schemas) |
| G4 | `base44 api grep read_only --limit 3` | 3 operations, each snippet shows `PersonalAccessTokenAuth":["read_only"]` | Pass |
| G5 | `base44 api grep value --area secrets` | the 3 secrets operations, no schemas | Pass |
| G6 | `base44 api grep -i availability --area custom-domains` | 2 operations: `availability` and `purchase-url` | Pass |
| G7 | `base44 api grep x --area nope` | error `Unknown API area: nope` + list of areas | Pass |
| G8 | `base44 api grep "(unclosed"` | error `Invalid regular expression` | Pass (integration test) |
| G9 | `base44 api grep trigger_status` | `[]` (field exists only in the test fixture) | Pass |
| G10 | `base44 api grep trigger_type --limit 3` | 3 hits (schemas) | Pass |

### `api catalog` (areas)

| # | Command | Wanted | Today |
|---|---|---|---|
| A1 | `base44 api catalog` | `total: 491`, areas include `workflows`, `secrets`, `apps`, `workspace` | Pass (61 areas) |
| A2 | `base44 api catalog secrets` | 3 operations: DELETE, GET, POST `/api/apps/{app_id}/secrets`, `total: 3` | Pass |
| A3 | `base44 api catalog sso` | 2 operations: GET and PUT `/sso/settings` | Pass |
| A4 | `base44 api catalog workflows` | 19 operations, includes `GET .../workflows/runs` | Pass |
| A5 | `base44 api catalog nope` | error `Unknown API area: nope` + list of areas | Pass |
| A6 | Sample summaries in `api catalog` should not be mostly "Delete …" | GET/POST first | **Fail** — e.g. agents: "Delete Superagent message", "Delete Superagent memory", "Delete Superagent webhook" |

Area names worth a look: `deploy`, `deploy-dist`, `request-deploy`, `undeploy` are four one-operation areas; `mcp`, `mcp-status`, `published-url` come from `/api/apps/platform/{app_id}/...`. The rule works, but 61 areas with many singletons is a lot for an agent to scan.

### `api fetch --help` (contract, sends nothing, no login needed)

| # | Command | Wanted | Today |
|---|---|---|---|
| H1 | `base44 api fetch GET /api/apps/68a1/workflows/runs --help` | path `/api/apps/{app_id}/workflows/runs`, `readOnly: true`, params `app_id, limit, offset, status, since`, refs include `RunItem` | Pass |
| H2 | `base44 api fetch POST /api/apps/68a1/secrets --help` | `readOnly: false`, `requestBody` present | Pass |
| H3 | `base44 api fetch GET "/api/apps/68a1/custom-domains/availability?domain=foo.com" --help` | matches ignoring the query; params `app_id, domain` | Pass (quote the path in zsh, `?` is a glob) |
| H4 | `base44 api fetch GET /api/apps/68a1/workflows/runs/ --help` | trailing slash ignored, same as H1 | Pass |
| H5 | `base44 api fetch get api/apps --help` | lowercase method and no leading slash accepted; `GET /api/apps` | Pass |
| H6 | `base44 api fetch GET /api/apps/68a1/workflows/runs --help --read-only` | `--help` wins, contract printed | Pass |
| H7 | `base44 api fetch --help` | command usage text | Pass (integration test) |
| H8 | `base44 api fetch GET /api/apps/68a1/brand-new --help` | error `No operation in the API spec matches` | Pass, but the hint should mention `--refresh` |

### `api fetch --read-only`

| # | Command | Wanted | Today |
|---|---|---|---|
| R1 | `base44 api fetch DELETE /api/apps/68a1/workflows/wf_9 --read-only` | refused, nothing sent, message names `DELETE /api/apps/{app_id}/workflows/{workflow_id}` | Pass |
| R2 | `base44 api fetch GET /api/apps/68a1/brand-new --read-only` | refused, nothing sent | Pass |
| R3 | `base44 --json api fetch GET /api/apps --read-only` | one JSON document on stdout, status lines on stderr | Pass — returned `[]` for this account; check whether `GET /api/apps` needs `workspace_id` |

### Not yet run (needs a real app id and a login)

| # | Command | Wanted |
|---|---|---|
| F1 | `base44 api fetch GET "/api/apps/<id>/workflows/runs?status=failed"` | JSON list; same as the `workflows` command output |
| F2 | `base44 api fetch POST /api/apps/<id>/secrets --body '{"TEST_KEY":"v"}'` then `DELETE` | 2xx both; then `secrets list` no longer shows it |
| F3 | `echo '{"TEST_KEY":"v"}' \| base44 api fetch POST /api/apps/<id>/secrets` | body taken from the pipe |
| F4 | `base44 api fetch DELETE /api/apps/<id>/secrets/TEST_KEY < /dev/null` | returns at once (no stdin hang) |
| F5 | `base44 api fetch DELETE ... ` spawned with stdin as an open pipe | today hangs (review item 3) |
| F6 | `base44 api fetch POST /api/apps/<id>/deploy` | must not time out at 10 s (review item 1) |
| F7 | `base44 --json api fetch GET /api/apps/<id>/forbidden` | JSON error envelope with `statusCode` and the server body (review items 6–7) |
| F8 | Two `base44 api search x --refresh` started at the same time | both succeed; cache file is complete afterwards (review item 2) |

## How these were run

From `packages/cli` on the branch, with Bun on `PATH`:

```bash
bun ./bin/dev.ts api search failed workflow runs
```

Outputs are JSON; piping through `jq '.[].path'` gives the ranking quickly.
