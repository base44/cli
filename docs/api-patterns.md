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

## Environment-Supplied Credentials (Stripe Projects Handoff)

When `BASE44_ACCESS_TOKEN` is set in the environment, `base44Client` uses it
verbatim as the bearer token, taking precedence over `~/.base44/auth/auth.json`
and **bypassing the OAuth refresh logic** (these tokens are provider-issued, not
Base44 OAuth tokens, so they cannot be refreshed via `/oauth/token`; on a 401 the
error simply propagates). `isLoggedIn()` also returns `true` when this var is set,
so `requireAuth` commands run without an interactive login. See
`getEnvAccessToken()` in `core/auth/config.js`.

This supports the Stripe Projects CLI handoff: it provisions a Base44 app and
writes the credentials to `.env` via `stripe projects env --pull`. The CLI loads
`.env`/`.env.local` from the working directory at startup (`loadProjectEnvFiles()`
in `core/utils/env.js`, wired through `cli/bootstrap-env.js` as the first import so
it runs before the HTTP clients capture `getBase44ApiUrl()`). Precedence: ambient
`process.env` > `.env.local` > `.env`; pre-set values are never overridden.

**Var name normalization.** `stripe projects env --pull` namespaces each var by
resource name, so the credentials arrive as e.g. `BASE44_PROJECTS_BASE44_APP_ID`
rather than bare `BASE44_APP_ID`. After loading, `loadProjectEnvFiles()` normalizes
the four credential keys (`BASE44_APP_ID`, `BASE44_ACCESS_TOKEN`,
`BASE44_REFRESH_TOKEN`, `BASE44_API_URL`): for each, if the bare name is unset and
exactly one `<PREFIX>_<KEY>` variable exists, its value is copied to the bare name.
This is prefix-agnostic (survives any resource name) and leaves the bare key unset
when ambiguous. The `base44 init` command then consumes `BASE44_APP_ID` to scaffold
a local project for that existing app.

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
