# AI Agent Guidelines for Base44 CLI Development

This document provides essential context and guidelines for AI agents working on the Base44 CLI project.

**Important**: Keep this file updated when making significant architectural changes.

## Project Overview

The Base44 CLI is a TypeScript-based command-line tool built with:
- **Commander.js** - CLI framework for command parsing
- **@clack/prompts** - Interactive user prompts and UI components
- **Zod** - Schema validation for API responses, config files, and user inputs
- **JSON5** - Parsing JSONC/JSON5 config files (supports comments and trailing commas)
- **TypeScript** - Primary language
- **tsdown** - Bundler (powered by Rolldown, the Rust-based Rollup successor)

### Distribution Strategy
The CLI is distributed as a **zero-dependency package**. All runtime dependencies are bundled into JavaScript files. This means:
- Users only download the bundled code (`dist/` and `bin/` directories)
- No dependency resolution or node_modules installation
- Faster install times and no version conflicts
- The npm `bin` field points to `./bin/run.js` which imports the bundled program

### Project Structure
- **Package**: `base44` - Single package published to npm
- **Core Module**: `src/core/` - Resources, utilities, errors, and config
- **CLI Module**: `src/cli/` - CLI commands and program definition
- **Bin Scripts**: `bin/` - Entry point scripts for dev and production

## Folder Structure

```
cli/
├── bin/                          # Entry point scripts
│   ├── run.js                    # Production entry (imports dist/index.js)
│   └── dev.js                    # Development entry (uses tsx for TypeScript)
├── src/
│   ├── core/
│   │   ├── api/                  # HTTP clients
│   │   │   ├── oauth-client.ts   # Unauthenticated client for login flow
│   │   │   ├── base44-client.ts  # Authenticated client with token refresh
│   │   │   └── index.ts
│   │   ├── auth/                 # User authentication
│   │   │   ├── api.ts            # OAuth API calls
│   │   │   ├── schema.ts         # Auth Zod schemas
│   │   │   ├── config.ts         # Token storage/refresh
│   │   │   └── index.ts
│   │   ├── project/              # Project configuration
│   │   │   ├── config.ts         # Project loading logic
│   │   │   ├── schema.ts         # Project/template schemas
│   │   │   ├── api.ts            # Project creation API
│   │   │   ├── create.ts         # Project scaffolding
│   │   │   ├── deploy.ts      
│   │   │   ├── template.ts       # Template rendering
│   │   │   ├── app-config.ts     # .app.jsonc read/write and caching
│   │   │   └── index.ts
│   │   ├── resources/            # Project resources (entity, function, etc.)
│   │   │   ├── types.ts          # Resource<T> interface
│   │   │   ├── entity/
│   │   │   │   ├── schema.ts
│   │   │   │   ├── config.ts
│   │   │   │   ├── resource.ts
│   │   │   │   ├── api.ts        
│   │   │   │   ├── deploy.ts     
│   │   │   │   └── index.ts
│   │   │   ├── function/
│   │   │   │   ├── schema.ts
│   │   │   │   ├── config.ts
│   │   │   │   ├── resource.ts
│   │   │   │   ├── api.ts        
│   │   │   │   ├── deploy.ts     
│   │   │   │   └── index.ts
│   │   │   ├── agent/
│   │   │   │   ├── schema.ts
│   │   │   │   ├── config.ts
│   │   │   │   ├── resource.ts
│   │   │   │   ├── api.ts
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── site/                 # Site deployment (NOT a Resource)
│   │   │   ├── schema.ts         # DeployResponse Zod schema
│   │   │   ├── config.ts         # getSiteFilePaths() - glob files for validation
│   │   │   ├── api.ts            # uploadSite() - reads archive, sends to API
│   │   │   ├── deploy.ts         # deploySite() - validates, creates tar.gz, uploads
│   │   │   └── index.ts
│   │   ├── utils/
│   │   │   ├── fs.ts             # File system utilities
│   │   │   └── index.ts
│   │   ├── consts.ts             # Pure constants (NO imports from other core modules)
│   │   ├── config.ts             # Path helpers (global dir, templates, API URL)
│   │   ├── errors.ts             # CLIError hierarchy (UserError, SystemError, etc.)
│   │   └── index.ts              # Barrel export for all core modules
│   └── cli/
│       ├── program.ts            # createProgram(context) factory
│       ├── index.ts              # runCLI() execution + barrel exports
│       ├── types.ts              # CLIContext type for dependency injection
│       ├── errors.ts             # CLI-specific errors (CLIExitError)
│       ├── commands/
│       │   ├── auth/
│       │   │   ├── login.ts      # getLoginCommand(context) factory
│       │   │   ├── login-flow.ts # login() logic (separate to avoid circular deps)
│       │   │   ├── logout.ts
│       │   │   └── whoami.ts
│       │   ├── project/
│       │   │   ├── create.ts
│       │   │   ├── dashboard.ts
│       │   │   ├── deploy.ts     # Unified deploy command
│       │   │   └── link.ts
│       │   ├── entities/
│       │   │   └── push.ts
│       │   ├── agents/
│       │   │   ├── index.ts      # getAgentsCommand(context) - parent command
│       │   │   ├── pull.ts
│       │   │   └── push.ts
│       │   ├── functions/
│       │   │   └── deploy.ts
│       │   └── site/
│       │       └── deploy.ts
│       ├── telemetry/            # Error reporting and telemetry
│       │   ├── consts.ts         # PostHog API key, env var names
│       │   ├── posthog.ts        # PostHog client singleton
│       │   ├── error-reporter.ts # ErrorReporter class for capturing exceptions
│       │   ├── commander-hooks.ts# Commander.js integration for command context
│       │   └── index.ts
│       └── utils/
│           ├── runCommand.ts     # Command wrapper with branding
│           ├── runTask.ts        # Spinner wrapper
│           ├── banner.ts         # ASCII art banner
│           ├── prompts.ts        # Prompt utilities
│           ├── theme.ts          # Centralized theme configuration (colors, styles)
│           ├── urls.ts           # URL utilities (getDashboardUrl)
│           └── index.ts
├── templates/                    # Project templates
├── tests/
├── dist/                         # Build output (program.js + templates/)
├── package.json
└── tsconfig.json
```

## Adding a New Command

Commands live in `src/cli/commands/`. Commands use a **factory pattern** with dependency injection via `CLIContext`.

### 1. Create the command file

```typescript
// src/cli/commands/<domain>/<action>.ts
import { Command } from "commander";
import { log } from "@clack/prompts";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

async function myAction(): Promise<RunCommandResult> {
  // Use runTask for async operations with spinners
  const result = await runTask(
    "Doing something...",
    async () => {
      // Your async operation here
      return someResult;
    },
    {
      // Use theme colors for success messages
      successMessage: theme.colors.base44Orange("Done!"),
      errorMessage: "Failed to do something",
    }
  );

  log.success("Operation completed!");

  // Return an optional outro message (displayed at the end)
  return { outroMessage: `Created ${theme.styles.bold(result.name)}` };
}

// Export a factory function that receives CLIContext
export function getMyCommand(context: CLIContext): Command {
  return new Command("<name>")
    .description("<description>")
    .option("-f, --flag", "Some flag")
    .action(async (options) => {
      await runCommand(myAction, { requireAuth: true }, context);
    });
}
```

**Important**:
- Commands export a **factory function** (`getMyCommand`), not a static command instance
- The factory receives `CLIContext` which contains the `errorReporter`
- Commands should NOT call `intro()` or `outro()` directly - `runCommand()` handles both
- The `context` must be passed to `runCommand()` as the third argument

### 2. Register in program.ts

```typescript
// src/cli/program.ts
import { getMyCommand } from "@/cli/commands/<domain>/<action>.js";

// Inside createProgram(context):
program.addCommand(getMyCommand(context));
```

### 3. Command wrapper options

```typescript
// Standard command - loads app config by default
await runCommand(myAction, undefined, context);

// Command with full ASCII art banner (for special commands like create)
await runCommand(myAction, { fullBanner: true }, context);

// Command requiring authentication (auto-login if needed)
await runCommand(myAction, { requireAuth: true }, context);

// Command that doesn't need app config (auth commands, create, link)
await runCommand(myAction, { requireAppConfig: false }, context);

// Command with multiple options
await runCommand(myAction, { fullBanner: true, requireAuth: true }, context);
```

**Options:**
- `fullBanner`: Show ASCII art banner instead of simple tag
- `requireAuth`: Check authentication before running (auto-login if needed)
- `requireAppConfig`: Load `.app.jsonc` and cache for sync access (default: `true`)

### 4. CLIContext and Dependency Injection

The `CLIContext` type (`src/cli/types.ts`) provides dependencies to commands:

```typescript
export interface CLIContext {
  errorReporter: ErrorReporter;
}
```

- Created once in `runCLI()` at CLI startup
- Passed to `createProgram(context)` which passes to each command factory
- Commands pass it to `runCommand()` for error reporting integration

## Theming

All CLI styling is centralized in `src/cli/utils/theme.ts`. **Never use `chalk` directly** - import `theme` from utils instead.

```typescript
import { theme } from "../../utils/index.js";

// Colors
theme.colors.base44Orange("Success!")     // Primary brand color
theme.colors.links(url)                   // URLs and links

// Styles  
theme.styles.bold(email)                  // Bold emphasis
theme.styles.header("Label")              // Dim text for labels
```

When adding new theme properties, use semantic names (e.g., `links`, `header`) not color names.

## Making API Calls

Use the HTTP clients from `@/core/api/index.js`:

### Authenticated API calls (most common)

```typescript
import { base44Client, getAppClient } from "@/core/api/index.js";

// For general Base44 API calls
const response = await base44Client.get("api/endpoint");
const data = await response.json();

// For app-specific API calls (requires .app.jsonc with id)
const appClient = getAppClient();
const response = await appClient.get("entities");
const entities = await response.json();

// POST with JSON body
const response = await base44Client.post("api/endpoint", {
  json: { key: "value" },
});
```

### OAuth endpoints (login flow only)

```typescript
import { oauthClient } from "@/core/api/index.js";

// Used only in auth/api.ts for device code flow
const response = await oauthClient.post("oauth/device/code", {
  json: { client_id: AUTH_CLIENT_ID, scope: "apps:read apps:write" },
});
```

### Token refresh

The `base44Client` automatically handles token refresh:
1. Before each request, checks if token is expired
2. If expired, refreshes token and saves new tokens
3. On 401 response, attempts refresh and retries once

## Resource Pattern

Resources are project-specific collections (entities, functions) that can be loaded from the filesystem.

### Resource Interface (`resources/types.ts`)

```typescript
export interface Resource<T> {
  readAll: (dir: string) => Promise<T[]>;
  push: (items: T[]) => Promise<unknown>;
}
```

Note: The `push` method handles empty arrays gracefully (returns early without API call).

### Resource Implementation (`resources/<name>/resource.ts`)

```typescript
export const entityResource: Resource<Entity> = {
  readAll: readAllEntities,
  push: pushEntities,
};
```

### Adding a New Resource

1. Create folder in `src/core/resources/<name>/`
2. Add `schema.ts` with Zod schemas
3. Add `config.ts` with file reading logic
4. Add `resource.ts` implementing `Resource<T>`
5. Add `api.ts` for API calls (if needed)
6. Add `index.ts` barrel exports
7. Update `resources/index.ts` to export the new resource
8. Register in `project/config.ts` (add to `readProjectConfig`)
9. Add typed field to `ProjectData` interface

## Site Module

The site module (`src/core/site/`) handles deploying built frontend files to Base44 hosting. Unlike Resources, the site module:

- Reads built artifacts (JS, CSS, HTML) from the output directory
- Gets configuration from `site.outputDirectory` in project config
- Creates a tar.gz archive and uploads it to the API

### Architecture

```
site/
├── schema.ts    # DeployResponse Zod schema
├── config.ts    # getSiteFilePaths() - glob files for validation
├── api.ts       # uploadSite() - reads archive, sends to API
├── deploy.ts    # deploySite() - validates, creates archive, uploads
└── index.ts     # Barrel exports
```

### Key Functions

```typescript
import { deploySite } from "@/core/site/index.js";

// Deploy site from output directory (returns deployment details)
const { appUrl } = await deploySite("./dist");
```

### Deploy Flow

1. Validate output directory exists and has files
2. Create temporary tar.gz archive using `tar` package
3. Upload archive to `POST /api/apps/{app_id}/deploy-dist`
4. Parse response with Zod schema
5. Clean up temporary archive file

### CLI Command

```bash
base44 site deploy
```

## Unified Deploy Command

The `base44 deploy` command deploys all project resources in one operation:

1. Pushes entities (via `entityResource.push()`)
2. Pushes functions (via `functionResource.push()`)
3. Deploys site (if `site.outputDirectory` is configured)

### Core Functions (`project/deploy.ts`)

```typescript
import { deployAll, hasResourcesToDeploy } from "@/core/project/index.js";

// Check if there's anything to deploy
if (!hasResourcesToDeploy(projectData)) {
  return;
}

// Deploy all resources
const { appUrl } = await deployAll(projectData);
```

### CLI Command

```bash
base44 deploy        # With confirmation prompt
base44 deploy -y     # Skip confirmation
base44 deploy --yes  # Skip confirmation
```

## Path Aliases

Single alias defined in `tsconfig.json`:
- `@/*` → `./src/*`

```typescript
import { readProjectConfig } from "@/core/project/index.js";
import { entityResource } from "@/core/resources/entity/index.js";
import { base44Client } from "@/core/api/index.js";
```

## Error Handling

The CLI uses a structured error hierarchy to provide clear, actionable error messages with hints for users and AI agents.

### Error Hierarchy

```
CLIError (abstract base class)
├── UserError (user did something wrong - fixable by user)
│   ├── AuthRequiredError      # Not logged in
│   ├── AuthExpiredError       # Token expired
│   ├── ConfigNotFoundError    # No project found
│   ├── ConfigInvalidError     # Invalid config syntax/structure
│   ├── ConfigExistsError      # Project already exists
│   ├── SchemaValidationError  # Zod validation failed
│   └── InvalidInputError      # Bad user input (template not found, etc.)
│
└── SystemError (something broke - needs investigation)
    ├── ApiError               # HTTP/network failures
    ├── FileNotFoundError      # File doesn't exist
    ├── FileReadError          # Can't read file
    └── InternalError          # Unexpected errors
```

### Error Properties

All errors extend `CLIError` and have these properties:

```typescript
interface CLIError {
  code: string;           // e.g., "AUTH_REQUIRED", "CONFIG_NOT_FOUND"
  isUserError: boolean;   // true for UserError, false for SystemError
  hints: ErrorHint[];     // Actionable suggestions
  cause?: Error;          // Original error for stack traces
}

interface ErrorHint {
  message: string;        // Human-readable hint
  command?: string;       // Optional command to run (for AI agents)
}
```

### Throwing Errors

Import errors from `@/core/errors.js`:

```typescript
import {
  ConfigNotFoundError,
  ConfigExistsError,
  SchemaValidationError,
  ApiError,
  InvalidInputError,
} from "@/core/errors.js";

// User errors - provide helpful hints
throw new ConfigNotFoundError();  // Has default hints for create/link

throw new ConfigExistsError("Project already exists at /path/to/config.jsonc");

throw new InvalidInputError(`Template "${templateId}" not found`, {
  hints: [
    { message: `Use one of: ${validIds}` },
  ],
});

// API errors - include status code for automatic hint generation
throw new ApiError("Failed to sync entities", { statusCode: response.status });
// 401 → hints to run `base44 login`
// 404 → hints about resource not found
// Other → hints to check network
```

### SchemaValidationError with Zod

`SchemaValidationError` requires a context message and a `ZodError`. It formats the error automatically using `z.prettifyError()`:

```typescript
import { SchemaValidationError } from "@/core/errors.js";

const result = EntitySchema.safeParse(parsed);

if (!result.success) {
  // Pass context message + ZodError - formatting is handled automatically
  throw new SchemaValidationError("Invalid entity file at " + entityPath, result.error);
}

// Output:
// Invalid entity file at /path/to/entity.jsonc:
// ✖ Invalid input: expected string, received number
//   → at name
```

**Important**: Do NOT manually call `z.prettifyError()` - the class does this internally.

### Error Code Reference

| Code               | Class                   | When to use                           |
| ------------------ | ----------------------- | ------------------------------------- |
| `AUTH_REQUIRED`    | `AuthRequiredError`     | User not logged in                    |
| `AUTH_EXPIRED`     | `AuthExpiredError`      | Token expired, needs re-login         |
| `CONFIG_NOT_FOUND` | `ConfigNotFoundError`   | No project/config file found          |
| `CONFIG_INVALID`   | `ConfigInvalidError`    | Config file has invalid content       |
| `CONFIG_EXISTS`    | `ConfigExistsError`     | Project already exists at location    |
| `SCHEMA_INVALID`   | `SchemaValidationError` | Zod validation failed                 |
| `INVALID_INPUT`    | `InvalidInputError`     | User provided invalid input           |
| `API_ERROR`        | `ApiError`              | API request failed                    |
| `FILE_NOT_FOUND`   | `FileNotFoundError`     | File doesn't exist                    |
| `FILE_READ_ERROR`  | `FileReadError`         | Can't read/write file                 |
| `INTERNAL_ERROR`   | `InternalError`         | Unexpected error                      |

### CLIExitError (Special Case)

`CLIExitError` in `src/cli/errors.ts` is for controlled exits (e.g., user cancellation). It's NOT reported to telemetry:

```typescript
import { CLIExitError } from "@/cli/errors.js";

// User cancelled a prompt
throw new CLIExitError(0);  // Exit code 0 = success (user chose to cancel)
```

## Telemetry & Error Reporting

The CLI reports errors to PostHog for monitoring. This is handled by the `ErrorReporter` class.

### Architecture

```
src/cli/telemetry/
├── consts.ts           # PostHog API key, env var names
├── posthog.ts          # PostHog client singleton
├── error-reporter.ts   # ErrorReporter class
├── commander-hooks.ts  # Adds command info to error context
└── index.ts            # Barrel exports
```

### ErrorReporter Usage

The `ErrorReporter` is created once in `runCLI()` and injected via `CLIContext`:

```typescript
// In runCLI() - creates and injects the reporter
const errorReporter = new ErrorReporter();
errorReporter.registerProcessErrorHandlers();
const context: CLIContext = { errorReporter };
const program = createProgram(context);

// Context is set throughout execution
errorReporter.setContext({ user: { email, name } });
errorReporter.setContext({ appId: "..." });
errorReporter.setContext({ command: { name, args, options } });

// Errors are captured automatically in runCLI's catch block
errorReporter.captureException(error);
```

### Disabling Telemetry

Set the environment variable: `BASE44_DISABLE_TELEMETRY=1`

### What's Captured

- Session ID and duration
- User email (if logged in)
- Command name, args, and options
- App ID (if in a project)
- System info (Node version, OS, platform)
- Error stack traces
- Error code and isUserError (for CLIError instances)

## Important Rules

1. **npm only** - Never use yarn
2. **Zod validation** - Required for all external data (API responses, config files)
3. **@clack/prompts** - For all user interaction (prompts, spinners, logs)
4. **ES Modules** - Use `.js` extensions in imports
5. **Cross-platform** - Use `path` module utilities, never hardcode separators
6. **Command factory pattern** - Commands export `getXCommand(context)` functions, not static instances
7. **Command wrapper** - All commands use `runCommand(fn, options, context)` utility
8. **Task wrapper** - Use `runTask()` for async operations with spinners
9. **consts.ts has no imports** - Keep `consts.ts` dependency-free to avoid circular deps
10. **Keep AGENTS.md updated** - Update this file when architecture changes
11. **Zero-dependency distribution** - All packages go in `devDependencies`; they get bundled at build time
12. **Use theme for styling** - Never use `chalk` directly in commands; import `theme` from utils and use semantic color/style names
13. **Use fs.ts utilities** - Always use `@/core/utils/fs.js` for file operations
14. **No direct process.exit()** - Throw `CLIExitError` instead; entry points handle the actual exit
15. **Use structured errors** - Never `throw new Error()`; use specific error classes from `@/core/errors.js` with appropriate hints
16. **SchemaValidationError requires ZodError** - Always pass `ZodError`: `new SchemaValidationError("context", result.error)` - don't call `z.prettifyError()` manually
17. **No dynamic imports** - Avoid `await import()` inside functions; use static imports at top of file

## Development

```bash
npm run build      # tsdown - bundles to dist/index.js
npm run typecheck  # tsc --noEmit - type checking only
npm run dev        # runs ./bin/dev.js (tsx for direct TypeScript execution)
npm run start      # runs ./bin/run.js (production, requires build first)
npm test           # vitest
npm run lint       # eslint
```

### Entry Points Architecture

The CLI uses a split architecture for better development experience:

**Production** (`./bin/run.js`):
- Used when installed via npm (`base44` command)
- Imports from bundled `dist/index.js`
- Requires `npm run build` first

**Development** (`./bin/dev.js`):
- Used during development (`npm run dev`)
- Uses `tsx` shebang to run TypeScript directly from `src/cli/index.ts`
- No build step required - changes are reflected immediately

**CLI Module** (`src/cli/`):
- `index.ts` - `runCLI()` execution, creates ErrorReporter and CLIContext
- `program.ts` - `createProgram(context)` factory that registers all commands
- `types.ts` - `CLIContext` type for dependency injection
- `telemetry/` - Error reporting via PostHog (see folder structure above)
- `errors.ts` - CLI-specific errors (CLIExitError)

**Error Handling Flow**:
1. `runCLI()` creates `ErrorReporter` and registers process error handlers
2. `createProgram(context)` builds the command tree with injected context
3. Commands throw errors → `runCommand()` catches, logs with `log.error()`, re-throws
4. `runCLI()` catches errors, reports to PostHog (if not CLIExitError)
5. Uses `process.exitCode = 1` (not `process.exit()`) to let event loop drain for telemetry
6. Telemetry can be disabled via `BASE44_DISABLE_TELEMETRY=1` environment variable

### Node.js Version

This project requires Node.js >= 20.19.0. A `.node-version` file is provided for fnm/nodenv.

### CLI Utilities

When adding async operations to CLI commands:
- Use `runTask()` from `src/cli/utils/runTask.ts` for operations with progress feedback
- Provides automatic spinner, success/error messages
- Follows existing patterns in `create.ts` (entity push, site deploy, skills install)
- Avoid manual try/catch with `log.message` for async operations

### Subprocess Logging in runTask

When running subprocesses with `execa` inside `runTask()`, use `{ shell: true }` without `stdio: "inherit"` to suppress subprocess output. The spinner provides user feedback, and subprocess logs would interfere with the UI.

```typescript
await runTask("Installing...", async () => {
  await execa("npx", ["-y", "some-package"], {
    cwd: targetPath,
    shell: true  // Suppresses subprocess output
  });
});
```

## Testing

**Build before testing**: Tests import the bundled `dist/index.js`, so run `npm run build && npm test`.

### Test Structure

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

### Writing Tests

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

### Testkit API

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

### API Mocks

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

### Testing Rules

1. **Build first** - Run `npm run build` before `npm test`
2. **Use fixtures** - Don't create project structures in tests
3. **Fixtures need `.app.jsonc`** - Add `base44/.app.jsonc` with `{ "id": "test-app-id" }`
4. **Interactive prompts can't be tested** - Only test via non-interactive flags
