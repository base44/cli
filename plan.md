# OAuth Connectors CLI Implementation Plan

Reference issue: https://github.com/base44/cli/issues/184

## Overview

Add OAuth connectors as a CLI resource, allowing users to define connector configurations in `connectors/*.jsonc` files and push them to Base44 apps.

---

## Task 1: Resource File Parsing

### Objective
Read and validate connector JSONC files from the `connectors/` directory.

### Subtasks

1.1. **Define Zod schemas**
   - `IntegrationTypeSchema` - enum of supported integration types:
     ```
     googlecalendar, googledrive, gmail, googlesheets, googledocs, googleslides,
     slack, notion, salesforce, hubspot, linkedin, tiktok
     ```
   - `ConnectorResourceSchema` - object with `type` and `scopes` array

1.2. **File structure**
   ```
   connectors/
   ├── googlecalendar.jsonc
   ├── slack.jsonc
   └── notion.jsonc
   ```

1.3. **Resource schema**
   ```jsonc
   // connectors/googlecalendar.jsonc
   {
     "type": "googlecalendar",
     "scopes": [
       "https://www.googleapis.com/auth/calendar.readonly",
       "https://www.googleapis.com/auth/calendar.events"
     ]
   }
   ```

1.4. **Validation behavior**
   | Scenario | Behavior |
   |----------|----------|
   | Unknown integration type | Error: reject file |
   | Unknown scope for integration | Warning only (OAuth provider validates) |
   | Empty scopes array | Warning (except Notion) |
   | Missing `type` field | Error: reject file |

1.5. **Implementation location**
   - Create `src/resources/connectors/` directory
   - Add `schema.ts` for Zod schemas
   - Add `reader.ts` for file reading logic

---

## Task 2: API Client

### Objective
Add methods to communicate with apper backend endpoints.

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/external-auth/auto-added-scopes` | GET | Get auto-added scopes mapping |
| `/api/apps/{app_id}/external-auth/list` | GET | List all connectors |
| `/api/apps/{app_id}/external-auth/initiate` | POST | Start OAuth flow |
| `/api/apps/{app_id}/external-auth/status` | GET | Poll for OAuth completion |
| `/api/apps/{app_id}/external-auth/integrations/{type}/remove` | DELETE | Hard delete connector |

### Subtasks

2.1. **Auto-added scopes endpoint** (no auth required)
   ```typescript
   async getAutoAddedScopes(): Promise<Record<IntegrationType, string[]>>
   ```
   - Response is highly cacheable (data rarely changes)
   - Consider caching in CLI session

2.2. **List connectors**
   ```typescript
   async listConnectors(appId: string): Promise<Connector[]>
   ```

2.3. **Initiate OAuth**
   ```typescript
   async initiateOAuth(appId: string, request: {
     integration_type: string;
     scopes: string[];
     force_reconnect: boolean;
   }): Promise<{
     redirect_url: string;
     connection_id: string;
     already_authorized: boolean;
   }>
   ```

2.4. **Poll status**
   ```typescript
   async getOAuthStatus(appId: string, params: {
     integration_type: string;
     connection_id: string;
   }): Promise<{ status: 'ACTIVE' | 'FAILED' | 'PENDING' }>
   ```

2.5. **Hard delete**
   ```typescript
   async removeConnector(appId: string, type: string): Promise<void>
   ```

### Implementation location
- Add to existing API client or create `src/api/external-auth.ts`

---

## Task 3: Push Comparison Logic

### Objective
Compare local connector definitions with upstream state and determine required actions.

### Scope Comparison Logic

```typescript
function scopesMatch(
  localScopes: string[],
  upstreamScopes: string[],
  autoAddedScopes: string[]
): boolean {
  const expected = new Set([...localScopes, ...autoAddedScopes]);
  const upstream = new Set(upstreamScopes);

  if (expected.size !== upstream.size) return false;
  for (const scope of expected) {
    if (!upstream.has(scope)) return false;
  }
  return true;
}
```

### Comparison Matrix

| Local File | Upstream State | Scopes Match? | Action |
|------------|----------------|---------------|--------|
| Exists | Not exists | N/A | Prompt auth URL + poll |
| Exists | `DISCONNECTED` | N/A | Hard delete + prompt auth URL + poll |
| Exists | `EXPIRED` | N/A | Hard delete + prompt auth URL + poll |
| Exists | `ACTIVE` | Yes | No-op |
| Exists | `ACTIVE` | No | Hard delete + prompt auth URL + poll |
| Not exists | Exists (any) | N/A | Hard delete upstream |

### Subtasks

3.1. **Fetch auto-added scopes**
   - Call `/api/external-auth/auto-added-scopes`
   - Cache for session duration

3.2. **Calculate expected scopes**
   ```typescript
   expectedScopes = localScopes ∪ autoAddedScopes
   ```

3.3. **Compare and determine actions**
   - For each local connector: determine if auth needed
   - For each upstream-only connector: mark for deletion

3.4. **Implementation location**
   - Create `src/resources/connectors/push.ts`

---

## Task 4: OAuth Flow Handling

### Objective
Handle interactive OAuth authentication with URL display and polling.

### Flow

1. Display auth URL to user (open in browser or show URL)
2. Poll `/status` endpoint every 2 seconds
3. Use same timeout as device login auth
4. Verify approved scopes after completion

### Post-Auth Verification

```typescript
function verifyApprovedScopes(
  localScopes: string[],
  approvedScopes: string[],
  autoAddedScopes: string[]
): boolean {
  const expected = new Set([...localScopes, ...autoAddedScopes]);
  const approved = new Set(approvedScopes);

  if (expected.size !== approved.size) return false;
  for (const scope of expected) {
    if (!approved.has(scope)) return false;
  }
  return true;
}
```

### Subtasks

4.1. **Auth URL display**
   - Show URL to user
   - Optionally auto-open in browser

4.2. **Polling loop**
   - 2 second interval
   - Timeout matching device auth
   - Handle ACTIVE, FAILED, PENDING states

4.3. **Sequential auth**
   - If multiple connectors need auth, process one at a time
   - Interactive state machine

4.4. **Edge cases**
   | Case | Handling |
   |------|----------|
   | Partial consent | Show `SCOPE_MISMATCH` status |
   | Different user | Show `DIFFERENT_USER` status with email |
   | Auth timeout | Show `PENDING_AUTH` status |
   | Auth failed | Show `AUTH_FAILED` status |

4.5. **Why always delete first?**
   - Apper's `/initiate` merges new scopes with existing (for AI use case)
   - CLI needs declarative state (JSONC = desired scopes)
   - Delete first ensures exact scopes, not union of old + new

---

## Task 5: Push Command Integration

### Objective
Wire connectors into the existing push command with summary output.

### Summary Output Format

```
Connectors push summary:
  - googlecalendar: active (3 scopes)
  - slack: active (4 scopes, re-authed)
  - linkedin: scope mismatch (requested 5, approved 3)
  - notion: auth not completed
  - hubspot: deleted (no local definition)

Some connectors need attention:
  - linkedin: Approved scopes differ from requested. Update connectors/linkedin.jsonc or run push again.
  - notion: Authentication not completed. Run push to retry.
```

### Status States

| Status | Color | Description |
|--------|-------|-------------|
| `ACTIVE` | green | Connector active, scopes match |
| `SCOPE_MISMATCH` | yellow | Active but approved ≠ requested |
| `PENDING_AUTH` | red | Auth URL shown but not completed |
| `AUTH_FAILED` | red | OAuth flow failed |
| `DELETED` | dim | Removed from upstream |
| `DIFFERENT_USER` | red | Another user already authorized |

### Subtasks

5.1. **Integrate with push command**
   - Add connectors to resource types handled by push
   - No pull support (push-only resource)

5.2. **Summary output**
   - Use `@clack/prompts` for logging
   - Color statuses with chalk

5.3. **Attention section**
   - Show actionable messages for non-success states

---

## File Structure (Proposed)

```
src/
├── resources/
│   └── connectors/
│       ├── schema.ts        # Zod schemas
│       ├── reader.ts        # File reading
│       ├── push.ts          # Push logic
│       └── index.ts         # Exports
├── api/
│   └── external-auth.ts     # API client methods
└── commands/
    └── push.ts              # Updated to include connectors
```

---

## Dependencies

- Existing: `zod`, `@clack/prompts`, `chalk`
- Backend: Issue #3325 for `/api/external-auth/auto-added-scopes` endpoint

---

## Testing Considerations

- Unit tests for scope comparison logic
- Unit tests for Zod schema validation
- Integration tests for push flow (mock API)
- Manual testing of OAuth flow (requires real OAuth providers)
