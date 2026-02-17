# Writing Tests

**Keywords:** test, vitest, testkit, setupCLITests, fixture, mock, Given/When/Then, BASE44_CLI_TEST_OVERRIDES, build before test, MSW

## Table of Contents

- [How Testing Works](#how-testing-works)
- [Test Structure](#test-structure)
- [Writing a Test](#writing-a-test)
- [Testkit API](#testkit-api) (Given / When / Then / File Assertions / Utilities)
- [API Mocks](#api-mocks) (Entity / Function / Agent / Site / Connector / Auth / Project / Generic)
- [Test Overrides](#test-overrides-base44_cli_test_overrides) (Adding a New Override)
- [Testing Rules](#testing-rules)

---

**Build before testing**: Tests import the bundled `dist/index.js`, so always run:

```bash
bun run build && bun run test
```

## How Testing Works

Tests use **MSW (Mock Service Worker)** to intercept HTTP requests. The testkit wraps MSW and provides a typed API for mocking Base44 endpoints. Tests run the actual bundled CLI code (from `dist/`), not source files.

This means:
- **`vi.mock()` won't work** with path aliases like `@/some/path.js` (they're resolved in the bundle)
- Use the **`BASE44_CLI_TEST_OVERRIDES` env var** for mocking behavior instead (see below)
- Always `bun run build` before `bun run test` to ensure the bundle is fresh
- Tests always run with `isNonInteractive: true` (no TTY), so browser opens and animations are skipped

## Test Structure

```
tests/
├── cli/                           # CLI integration tests
│   ├── testkit/                   # Test utilities (CLITestkit, Base44APIMock)
│   ├── <command>.spec.ts          # e.g., login.spec.ts, deploy.spec.ts
│   └── <parent>_<sub>.spec.ts     # e.g., entities_push.spec.ts
├── core/                          # Core module unit tests
│   ├── agents.spec.ts
│   ├── errors.spec.ts
│   └── project.spec.ts
└── fixtures/                      # Test project directories
    ├── basic/                     # Minimal linked project
    ├── with-entities/             # Project with entities
    ├── with-agents/               # Project with agents
    ├── with-connectors/           # Project with connectors
    ├── with-functions-and-entities/
    ├── with-site/                 # Project with site config
    ├── full-project/              # All resources combined
    ├── no-app-config/             # Unlinked project (no .app.jsonc)
    └── invalid-*/                 # Error case fixtures
```

## Writing a Test

```typescript
import { describe, it } from "vitest";
import { setupCLITests, fixture } from "./testkit/index.js";

describe("<command> command", () => {
  const t = setupCLITests();

  it("succeeds when <scenario>", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockEntitiesPush({ created: ["User"], updated: [], deleted: [] });

    // When
    const result = await t.run("entities", "push");

    // Then
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Entities pushed");
  });

  it("fails when API returns error", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockEntitiesPushError({ status: 500, body: { error: "Server error" } });

    // When
    const result = await t.run("entities", "push");

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContainInStderr("Server error");
  });
});
```

## Testkit API

### Setup

`setupCLITests()` -- Call inside `describe()`, returns test context `t`. Handles MSW server lifecycle, temp directory creation/cleanup, and test isolation automatically.

### Given (Setup State)

```typescript
// Set up authenticated user with default user (test@example.com)
await t.givenLoggedInWithProject(fixture("with-entities"));

// Set up authenticated user with custom user
await t.givenLoggedInWithProject(fixture("with-entities"), {
  email: "alice@example.com",
  name: "Alice",
});

// Set up auth and project separately
await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
await t.givenProject(fixture("with-entities"));

// Mock the npm version check (null = no upgrade available, string = upgrade available)
t.givenLatestVersion(null);           // Default: no upgrade notification
t.givenLatestVersion("2.0.0");        // Simulate upgrade available
```

### When (Execute)

```typescript
// Run a CLI command
const result = await t.run("entities", "push");
const result = await t.run("deploy", "--yes");
const result = await t.run("login");
```

`result` is a `CLIResult` object:

```typescript
interface CLIResult {
  stdout: string;   // Captured standard output
  stderr: string;   // Captured standard error
  exitCode: number; // 0 = success, non-zero = failure
}
```

### Then (Assertions)

```typescript
// Exit code assertions
t.expectResult(result).toSucceed();              // exitCode === 0
t.expectResult(result).toFail();                 // exitCode !== 0
t.expectResult(result).toHaveExitCode(2);        // Specific exit code

// Output assertions (searches both stdout + stderr)
t.expectResult(result).toContain("Success");
t.expectResult(result).toNotContain("Error");

// Targeted output assertions
t.expectResult(result).toContainInStdout("Created entity");
t.expectResult(result).toContainInStderr("Server error");
```

### File Assertions

```typescript
// Read a file from the project directory
const content = await t.readProjectFile("base44/.app.jsonc");

// Check if a file exists in the project directory
const exists = await t.fileExists("base44/entities/user.jsonc");

// Read the auth file (for login tests)
const authData = await t.readAuthFile();
```

### Utilities

```typescript
fixture("with-entities")  // Resolve fixture path: tests/fixtures/with-entities
t.getTempDir()            // Get the temp directory path (isolated per test)
```

## API Mocks

The `t.api` object provides typed mocks for all Base44 API endpoints. Mock methods are chainable.

### Entity Mocks

```typescript
t.api.mockEntitiesPush({ created: ["User"], updated: ["Task"], deleted: [] });
t.api.mockEntitiesPushError({ status: 500, body: { error: "Server error" } });
```

### Function Mocks

```typescript
t.api.mockFunctionsPush({ deployed: ["handler"], deleted: [], errors: null });
t.api.mockFunctionsPushError({ status: 400, body: { error: "Invalid" } });
```

### Agent Mocks

```typescript
t.api.mockAgentsPush({ created: ["support"], updated: [], deleted: [] });
t.api.mockAgentsFetch({ items: [{ name: "support" }], total: 1 });
t.api.mockAgentsPushError({ status: 401, body: { error: "Unauthorized" } });
t.api.mockAgentsFetchError({ status: 500, body: { error: "Server error" } });
```

### Site Mocks

```typescript
t.api.mockSiteDeploy({ app_url: "https://app.base44.app" });
t.api.mockSiteUrl({ url: "https://app.base44.app" });
t.api.mockSiteDeployError({ status: 413, body: { error: "Too large" } });
t.api.mockSiteUrlError({ status: 404, body: { error: "Not found" } });
```

### Connector Mocks

```typescript
t.api.mockConnectorsList({
  integrations: [
    { integration_type: "googlecalendar", status: "ACTIVE", scopes: ["..."] },
  ],
});
t.api.mockConnectorSet({
  redirect_url: "https://accounts.google.com/...",
  connection_id: "conn-123",
  already_authorized: false,
});
t.api.mockConnectorOAuthStatus({ status: "ACTIVE" });
t.api.mockConnectorRemove({ status: "removed", integration_type: "googlecalendar" });
t.api.mockConnectorsListError({ status: 500, body: { error: "Server error" } });
t.api.mockConnectorSetError({ status: 401, body: { error: "Unauthorized" } });
```

### Auth Mocks

```typescript
t.api.mockDeviceCode({
  device_code: "dev-code",
  user_code: "USER-CODE",
  verification_uri: "https://base44.com/activate",
  expires_in: 900,
  interval: 5,
});
t.api.mockToken({
  access_token: "new-token",
  refresh_token: "new-refresh",
  expires_in: 3600,
  token_type: "Bearer",
});
t.api.mockUserInfo({ email: "test@example.com", name: "Test User" });
t.api.mockTokenError({ status: 401, body: { error: "invalid_grant" } });
t.api.mockUserInfoError({ status: 401, body: { error: "Unauthorized" } });
```

### Project Mocks

```typescript
t.api.mockCreateApp({ id: "app-123", name: "My App" });
t.api.mockListProjects([
  { id: "app-1", name: "App One", is_managed_source_code: true },
  { id: "app-2", name: "App Two" },
]);
t.api.mockProjectEject(tarContentAsUint8Array);
```

### Generic Error Mock

For endpoints without a specific error helper:

```typescript
t.api.mockError("get", "/api/apps/test-app-id/some-endpoint", {
  status: 500,
  body: { error: "Something went wrong" },
});
```

**Note**: All API mocks use **snake_case** keys (e.g., `is_managed_source_code`, `app_url`) to match the real API. The CLI code uses camelCase after Zod transformation.

## Test Overrides (`BASE44_CLI_TEST_OVERRIDES`)

For behaviors that can't be mocked via MSW (like filesystem-based config loading), the CLI uses a centralized JSON override mechanism.

**Current overrides:**
- `appConfig` -- Mock app configuration (id, projectRoot). Set automatically by `givenProject()`
- `latestVersion` -- Mock version check response (string for newer version, null for no update). Defaults to `null`

### Adding a New Override

1. Add the field to `TestOverrides` interface in `CLITestkit.ts`:

```typescript
interface TestOverrides {
  appConfig?: { id: string; projectRoot: string };
  latestVersion?: string | null;
  myNewOverride?: MyType;  // Add here
}
```

2. Add a `given*` method to `CLITestkit`:

```typescript
givenMyOverride(value: MyType): void {
  this.testOverrides.myNewOverride = value;
}
```

3. Expose it in `testkit/index.ts` `TestContext` interface and implementation.

4. Read the override in your source code:

```typescript
function getTestOverride(): MyType | undefined {
  const overrides = process.env.BASE44_CLI_TEST_OVERRIDES;
  if (!overrides) return undefined;
  try {
    return JSON.parse(overrides).myNewOverride;
  } catch {
    return undefined;
  }
}
```

## Testing Rules

1. **Build first** -- Always `bun run build` before `bun run test`
2. **Use fixtures** -- Don't create project structures in tests; use `tests/fixtures/`
3. **Fixtures need `.app.jsonc`** -- Add `base44/.app.jsonc` with `{ "id": "test-app-id" }`
4. **Interactive prompts can't be tested** -- Only test via non-interactive flags
5. **Use test overrides** -- Extend `BASE44_CLI_TEST_OVERRIDES` for new testable behaviors; don't create new env vars
6. **Mock snake_case, code camelCase** -- API mocks use snake_case keys matching the real API
