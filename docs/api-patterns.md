# Making API Calls

**Keywords:** API, HTTP, ky, base44Client, getAppClient, oauthClient, token refresh, snake_case, camelCase, Zod transform, schema.ts

The CLI uses `ky` HTTP clients from `packages/cli/src/core/clients/`. There are three clients for different contexts.

## Authenticated API Calls (Most Common)

```typescript
import { base44Client, getAppClient } from "@/core/clients/index.js";

// General Base44 API calls
const response = await base44Client.get("api/endpoint");
const data = await response.json();

// App-specific API calls (requires .app.jsonc with id)
const appClient = getAppClient();
const response = await appClient.get("entities");
const entities = await response.json();

// POST with JSON body
const response = await base44Client.post("api/endpoint", {
  json: { key: "value" },
});
```

## OAuth Endpoints (Login Flow Only)

```typescript
import { oauthClient } from "@/core/clients/index.js";

const response = await oauthClient.post("oauth/device/code", {
  json: { client_id: AUTH_CLIENT_ID, scope: "apps:read apps:write" },
});
```

Used only in `packages/cli/src/core/auth/api.ts` for the device code flow.

## Token Refresh

The `base44Client` automatically handles token refresh:
1. Before each request, checks if token is expired
2. If expired, refreshes token and saves new tokens
3. On 401 response, attempts refresh and retries once

## Environment-Supplied Credentials

For non-interactive flows (CI, agents, provisioning tools) that hand off an
app's credentials via the environment, the `ensureAuth` middleware calls
`seedAuthFromEnv()`: when `BASE44_ACCESS_TOKEN` is set, it decodes the JWT
(`sub` → `email`, `exp` → `expiresAt`; no signature check — the server
validates), pairs it with `BASE44_REFRESH_TOKEN`, and writes a standard
`~/.base44/auth/auth.json`, so everything downstream uses one file-based path.

This overwrites an existing login when env vars are present, and no-ops when
they can't form a complete record. The seeded file looks like a normal login, so
a 401 refresh applies to it too; if refresh fails it deletes the file, which
self-heals on the next command (re-seeded from the still-present env vars). See
`seedAuthFromEnv()` in `core/auth/config.js`.

Credentials load from `.env`/`.env.local` at startup via `loadProjectEnvFiles()`
(`core/utils/env.js`), wired through `cli/bootstrap-env.js` as the first import
so it runs before the HTTP clients capture `getBase44ApiUrl()`. Precedence:
ambient `process.env` > `.env.local` > `.env`. The Stripe Projects CLI namespaces
its vars (`BASE44_PROJECTS_BASE44_*`), so the loader also copies those to the
bare `BASE44_*` names when the bare name is unset.

## API Response Transformation (snake_case to camelCase)

The Base44 API returns snake_case keys, but the CLI uses camelCase. Use Zod's `.transform()` to convert:

```typescript
// In schema.ts - define schema with snake_case, transform to camelCase
export const ProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    user_description: z.string().optional().nullable(),
    is_managed_source_code: z.boolean().optional(),
  })
  .transform((data) => ({
    id: data.id,
    name: data.name,
    userDescription: data.user_description,
    isManagedSourceCode: data.is_managed_source_code,
  }));

export type Project = z.infer<typeof ProjectSchema>;
```

**Important**:
- `z.infer<typeof Schema>` gives the **transformed** type (camelCase)
- Test mocks should use **snake_case** (matching the real API); Zod handles the transformation
- See `packages/cli/src/core/auth/schema.ts` and `packages/cli/src/core/site/schema.ts` for more examples

## API Error Handling Pattern

When making HTTP requests, use `ApiError.fromHttpError()` to convert HTTP errors:

```typescript
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import { MyResponseSchema } from "./schema.js";

export async function myApiFunction(data: MyData): Promise<MyResponse> {
  const appClient = getAppClient();

  let response;
  try {
    response = await appClient.put("endpoint", { json: data });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "performing action");
  }

  const result = MyResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError("Invalid response from server", result.error);
  }

  return result.data;
}
```

This pattern ensures:
- HTTP errors are converted to structured `ApiError` instances with status codes
- 401 errors automatically hint the user to run `base44 login`
- Response data is validated with Zod before use
