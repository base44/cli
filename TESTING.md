# Testing Guide

**Build before testing**: Tests import the bundled `dist/index.js`, so run `npm run build && npm test`.

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
    ├── with-functions-and-entities/
    ├── with-site/                 # Project with site config
    ├── full-project/              # All resources combined
    ├── no-app-config/             # Unlinked project (no .app.jsonc)
    └── invalid-*/                 # Error case fixtures
```

## Writing Tests

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
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockEntitiesPushError({ status: 500, body: { error: "Server error" } });

    const result = await t.run("entities", "push");

    t.expectResult(result).toFail();
  });
});
```

## Testkit API

**Setup:**
- `setupCLITests()` - Call inside `describe()`, returns test context `t`

**Given (setup):**
- `t.givenLoggedIn({ email, name })` - Create auth file
- `t.givenProject(fixturePath)` - Set project directory
- `t.givenLoggedInWithProject(fixturePath)` - Combined (most common)

**When (actions):**
- `t.run(...args)` - Execute CLI command

**Then (assertions):**
- `t.expectResult(result).toSucceed()` - Exit code 0
- `t.expectResult(result).toFail()` - Exit code non-zero
- `t.expectResult(result).toContain(text)` - Output contains text

**Utilities:**
- `fixture(name)` - Resolve fixture path
- `t.getTempDir()` - Get temp directory
- `t.readAuthFile()` - Read saved auth data

## API Mocks

```typescript
// Success responses
t.api.mockEntitiesPush({ created: [], updated: [], deleted: [] });
t.api.mockFunctionsPush({ deployed: [], deleted: [], errors: null });
t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
t.api.mockAgentsFetch({ items: [], total: 0 });
t.api.mockSiteDeploy({ app_url: "https://app.base44.app" });
t.api.mockCreateApp({ id: "app-id", name: "App" });
t.api.mockDeviceCode({ device_code: "...", user_code: "...", ... });
t.api.mockToken({ access_token: "...", refresh_token: "...", ... });
t.api.mockUserInfo({ email: "...", name: "..." });

// Error responses
t.api.mockEntitiesPushError({ status: 500, body: { error: "..." } });
t.api.mockFunctionsPushError({ status: 400, body: { error: "..." } });
t.api.mockAgentsPushError({ status: 401, body: { error: "..." } });
t.api.mockSiteDeployError({ status: 413, body: { error: "..." } });
```

## Testing Rules

1. **Build first** - Run `npm run build` before `npm test`
2. **Use fixtures** - Don't create project structures in tests
3. **Fixtures need `.app.jsonc`** - Add `base44/.app.jsonc` with `{ "id": "test-app-id" }`
4. **Interactive prompts can't be tested** - Only test via non-interactive flags
