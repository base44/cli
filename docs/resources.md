# Working with Resources

**Keywords:** resource, entity, function, agent, agent skill, connector, push, readAll, deploy, site, tar.gz, deployAll, ProjectData

Resources are project-specific collections (entities, functions, agents, agent skills, connectors) that can be read from the filesystem and pushed to the Base44 API.

## Resource Interface

Defined in `packages/cli/src/resources/types.ts`:

```typescript
export interface Resource<T> {
  readAll: (dir: string) => Promise<T[]>;
  push: (items: T[]) => Promise<unknown>;
}
```

The `push` method handles empty arrays gracefully (returns early without making an API call).

## Resource Implementation

Each resource follows a consistent file structure inside `packages/cli/src/core/resources/<name>/`:

```
<name>/
├── schema.ts      # Zod schemas for validation
├── config.ts      # File reading logic (reads from filesystem)
├── resource.ts    # Resource<T> implementation
├── api.ts         # API calls (push to server)
└── index.ts       # Barrel exports
```

Example implementation:

```typescript
// resources/<name>/resource.ts
export const entityResource: Resource<Entity> = {
  readAll: readAllEntities,
  push: pushEntities,
};
```

## Adding a New Resource

1. Create folder: `packages/cli/src/core/resources/<name>/`
2. Add `schema.ts` with Zod schemas
3. Add `config.ts` with file reading logic
4. Add `resource.ts` implementing `Resource<T>`
5. Add `api.ts` for API calls
6. Add `index.ts` barrel exports
7. Update `packages/cli/src/core/resources/index.ts` to export the new resource
8. Register in `packages/cli/src/core/project/config.ts` (add to `readProjectConfig`)
9. Add typed field to `ProjectData` interface

## Backend functions (project layout)

Functions are read from the project's functions directory (e.g. `base44/functions/` or path from `config.jsonc`). Two discovery modes:

**Config-based:** A folder that contains `function.jsonc` (or `function.json`) is a function. The config defines `name`, `entry` (path to the handler file), and optional `automations`. The config file can live at any depth under the functions dir (e.g. `functions/foo/bar/function.jsonc`). All `*.js`, `*.ts`, and `*.json` files in that folder and subfolders are included when deploying.

**Zero-config:** A folder that contains `entry.js` or `entry.ts` and has no `function.jsonc` in the same folder is also a function. The function name is the path from the functions root to that folder (e.g. `functions/foo/bar/hello/entry.ts` → name `foo/bar/hello`). File collection is recursive: all `**/*.{js,ts,json}` under that folder are included.

If both exist in the same folder (e.g. `function.jsonc` and `entry.ts`), the config wins: the function is loaded from the config and the name/entry come from the config file. Duplicate function names (same path or same config name) cause an error.

### Entry file contract

Deploy ships file contents verbatim — the source is never parsed or linted — so this contract is enforced only when running locally. An entry file default-exports an async request handler:

- `export default async function (req) { ... }` — takes a `Request`, returns a `Response`.

Entry files may also import `secrets` and `waitUntil` from `base44:runtime`. Locally, `base44 dev` runs functions on workerd via Miniflare by default — each function is bundled with esbuild + `@deno/loader` (`src/cli/dev/dev-server/function-bundler.ts`), with `base44:runtime` served as a virtual module, secrets as real Worker env bindings and `waitUntil` riding `ctx.waitUntil`. A fallback runtime covers installations where workerd is unavailable (compiled binaries, `B44_DEV_FUNCTIONS_RUNTIME=deno`) and supplies `base44:runtime` via an import map. A project-level `deno.json` import map is not applied to functions — locally or deployed — since only files under `base44/` are uploaded. See [`packages/cli/backend-runtime/README.md`](../packages/cli/backend-runtime/README.md) for the local implementation and its intentional differences from production.

## Agent skills

Agent skills are app-scoped instruction snippets shared across the app's agents. Unlike other resources they are stored as one markdown file per skill under the agent-skills directory (`base44/agent-skills/`, or `agentSkillsDir` in `config.jsonc`): the filename (without `.md`) is the skill name, the frontmatter `description` is the summary, and the body is the instruction text. Agents reference skills by name via `selected_skill_names`; `selected_workspace_skill_ids` (org-shared workspace skills) is not managed here and is passed through pull/push/deploy untouched.

## Site Module (Not a Resource)

The site module at `packages/cli/src/core/site/` handles deploying an app's built output. It follows a different pattern than resources — there is no item list, so no `readAll`/`push`.

It exposes **two ways to ship `site.outputDirectory`**, and the caller picks:

```typescript
import { deploySite, deployStaticSite } from "@/core/site/index.js";

// Legacy: tar.gz the built files, POST /api/apps/{app_id}/deploy-dist
const { appUrl } = await deploySite(outputDir);

// Deployments API (env-gated lane, see deployments.md)
const { deploymentId } = await deployStaticSite({ outputDir, gitHash });
```

`base44 site deploy` chooses between them on whether `--git-hash` was passed; `base44 deploy` always uses `deploySite()` via `deployAll()`. The lane's own files are `gate.ts`, `manifest.ts`, `static-site.ts`, and `upload.ts`; both transports share the module's `api.ts` and `schema.ts`.

### Deploy Flow

1. Validate output directory exists and has files
2. Create temporary tar.gz archive using `tar` package
3. Upload archive to the API
4. Parse response with Zod schema
5. Clean up temporary archive file

## Unified Deploy Command

The `base44 deploy` command deploys all project resources in one operation:

```typescript
import { deployAll, hasResourcesToDeploy } from "@/core/project/index.js";

if (!hasResourcesToDeploy(projectData)) {
  return;
}

const { appUrl } = await deployAll(projectData);
```

What it deploys (in order):
1. Entities (via `entityResource.push()`)
2. Functions (via `functionResource.push()`)
3. Agent skills (via `agentSkillResource.push()`)
4. Agents (via `agentResource.push()`)
5. Connectors (via `pushConnectors()`) -- may return OAuth redirect URLs
6. Site (if `site.outputDirectory` is configured) — the legacy tar.gz upload. The env-gated deployments-API lane is reachable only from `base44 site deploy`, not from here (see [deployments.md](deployments.md)).

```bash
base44 deploy        # With confirmation prompt
base44 deploy -y     # Skip confirmation
base44 deploy --yes  # Skip confirmation
```
