# Working with Resources

**Keywords:** resource, entity, function, agent, connector, push, readAll, deploy, site, tar.gz, deployAll, ProjectData

Resources are project-specific collections (entities, functions, agents, connectors) that can be read from the filesystem and pushed to the Base44 API.

## Resource Interface

Defined in `src/core/resources/types.ts`:

```typescript
export interface Resource<T> {
  readAll: (dir: string) => Promise<T[]>;
  push: (items: T[]) => Promise<unknown>;
}
```

The `push` method handles empty arrays gracefully (returns early without making an API call).

## Resource Implementation

Each resource follows a consistent file structure inside `src/core/resources/<name>/`:

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

1. Create folder: `src/core/resources/<name>/`
2. Add `schema.ts` with Zod schemas
3. Add `config.ts` with file reading logic
4. Add `resource.ts` implementing `Resource<T>`
5. Add `api.ts` for API calls
6. Add `index.ts` barrel exports
7. Update `src/core/resources/index.ts` to export the new resource
8. Register in `src/core/project/config.ts` (add to `readProjectConfig`)
9. Add typed field to `ProjectData` interface

## Site Module (Not a Resource)

The site module at `src/core/site/` handles deploying built frontend files. It follows a different pattern than resources:

- Reads built artifacts (JS, CSS, HTML) from the output directory
- Gets configuration from `site.outputDirectory` in project config
- Creates a tar.gz archive and uploads it via `POST /api/apps/{app_id}/deploy-dist`

```typescript
import { deploySite } from "@/core/site/index.js";

const { appUrl } = await deploySite("./dist");
```

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
3. Agents (via `agentResource.push()`)
4. Connectors (via `pushConnectors()`) -- may return OAuth redirect URLs
5. Site (if `site.outputDirectory` is configured)

```bash
base44 deploy        # With confirmation prompt
base44 deploy -y     # Skip confirmation
base44 deploy --yes  # Skip confirmation
```
