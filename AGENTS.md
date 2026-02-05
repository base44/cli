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
- **Bun** - Runtime, bundler, and package manager
- **Biome** - Linting and formatting (fast, replaces ESLint)
- **Vitest** - Test runner

### Distribution Strategy
The CLI is distributed as a **zero-dependency npm package**. All runtime dependencies are bundled into JavaScript files. This means:
- Users only download the bundled code (`dist/` and `bin/` directories)
- No dependency resolution or node_modules installation
- Faster install times and no version conflicts
- The npm `bin` field points to `./bin/run.js` which imports the bundled program

### Project Structure
- **Package**: `base44` - Single package published to npm
- **Core Module**: `src/core/` - SDK, resources, utilities, errors, and config
- **CLI Module**: `src/cli/` - CLI commands and program definition
- **Bin Scripts**: `bin/` - Entry point scripts for dev and production

### SDK Architecture

The CLI uses an **SDK facade pattern** to decouple the CLI layer from the core module. The `Base44LocalProjectSDK` class provides a unified interface for all project operations:

```typescript
// Create SDK from current directory
const sdk = await Base44LocalProjectSDK.fromCurrentDirectory();

// Use namespaced APIs
const entities = await sdk.entities.readAll();
await sdk.entities.push(entities);
await sdk.deployAll();

// Static methods for auth (no project needed)
await Base44LocalProjectSDK.auth.login();
await Base44LocalProjectSDK.auth.requireAuth();

// Static methods for project operations
await Base44LocalProjectSDK.project.create({ name, path, template });
await Base44LocalProjectSDK.project.link(projectRoot, appId);
```

## Folder Structure

```
cli/
├── bin/                          # Entry point scripts
│   ├── run.js                    # Production entry (imports dist/index.js)
│   └── dev.ts                    # Development entry (Bun runs TypeScript directly)
├── src/
│   ├── core/
│   │   ├── clients/              # HTTP clients
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
│   │   │   ├── app-config.ts     # .app.jsonc read/write (deprecated caching)
│   │   │   └── index.ts
│   │   ├── resources/            # Project resources (entity, function, etc.)
│   │   │   ├── entity/
│   │   │   │   ├── schema.ts
│   │   │   │   ├── config.ts     # readAllEntities()
│   │   │   │   ├── api.ts        # syncEntities()
│   │   │   │   ├── deploy.ts     # pushEntities()
│   │   │   │   └── index.ts
│   │   │   ├── function/
│   │   │   │   ├── schema.ts
│   │   │   │   ├── config.ts     # readAllFunctions()
│   │   │   │   ├── api.ts        # deployFunctions()
│   │   │   │   ├── deploy.ts     # pushFunctions()
│   │   │   │   └── index.ts
│   │   │   ├── agent/
│   │   │   │   ├── schema.ts
│   │   │   │   ├── config.ts     # readAllAgents(), writeAgents()
│   │   │   │   ├── api.ts        # pushAgents(), fetchAgents()
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── sdk/                  # SDK facade (NEW)
│   │   │   ├── sdk.ts            # Base44LocalProjectSDK class
│   │   │   ├── types.ts          # SDKConfig, AppClient types
│   │   │   ├── auth-namespace.ts # AuthNamespace (static methods)
│   │   │   ├── project-namespace.ts
│   │   │   ├── entities-namespace.ts
│   │   │   ├── functions-namespace.ts
│   │   │   ├── agents-namespace.ts
│   │   │   ├── site-namespace.ts
│   │   │   └── index.ts
│   │   ├── site/                 # Site deployment
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
│   │   └── index.ts              # Barrel export (includes SDK)
│   └── cli/
│       ├── program.ts            # createProgram(context) factory
│       ├── index.ts              # runCLI() execution + barrel exports
│       ├── types.ts              # CLIContext type (includes sdk property)
│       ├── errors.ts             # CLI-specific errors (CLIExitError)
│       ├── commands/
│       │   ├── auth/
│       │   │   ├── login.ts      # getLoginCommand(context) factory
│       │   │   ├── login-flow.ts # login() logic (uses SDK.auth)
│       │   │   ├── logout.ts
│       │   │   └── whoami.ts
│       │   ├── project/
│       │   │   ├── create.ts     # Uses SDK.project.create
│       │   │   ├── dashboard.ts
│       │   │   ├── deploy.ts     # Uses sdk.deployAll()
│       │   │   └── link.ts       # Uses SDK.project.link
│       │   ├── entities/
│       │   │   └── push.ts       # Uses sdk.entities
│       │   ├── agents/
│       │   │   ├── index.ts      # getAgentsCommand(context) - parent command
│       │   │   ├── pull.ts       # Uses sdk.agents.pull()
│       │   │   └── push.ts       # Uses sdk.agents.push()
│       │   ├── functions/
│       │   │   └── deploy.ts     # Uses sdk.functions.deploy()
│       │   └── site/
│       │       └── deploy.ts     # Uses sdk.site.deploy()
│       ├── telemetry/            # Error reporting and telemetry
│       │   ├── consts.ts         # PostHog API key, env var names
│       │   ├── posthog.ts        # PostHog client singleton
│       │   ├── error-reporter.ts # ErrorReporter class for capturing exceptions
│       │   ├── commander-hooks.ts# Commander.js integration for command context
│       │   └── index.ts
│       └── utils/
│           ├── runCommand.ts     # Command wrapper (creates SDK, passes to commands)
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

Commands live in `src/cli/commands/`. Commands use a **factory pattern** with dependency injection via `CLIContext`, and receive the SDK instance via `runCommand()`.

### 1. Create the command file

```typescript
// src/cli/commands/<domain>/<action>.ts
import { Command } from "commander";
import { log } from "@clack/prompts";
import type { CLIContext } from "@/cli/types.js";
import type { Base44LocalProjectSDK } from "@/core/index.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

// Commands receive the SDK as first parameter
async function myAction(sdk: Base44LocalProjectSDK): Promise<RunCommandResult> {
  // Use SDK for all project operations
  const entities = await sdk.entities.readAll();

  // Use runTask for async operations with spinners
  const result = await runTask(
    "Pushing entities...",
    async () => {
      return await sdk.entities.push(entities);
    },
    {
      successMessage: theme.colors.base44Orange("Done!"),
      errorMessage: "Failed to push entities",
    }
  );

  log.success("Operation completed!");

  return { outroMessage: `Pushed ${result.created.length} entities` };
}

// Export a factory function that receives CLIContext
export function getMyCommand(context: CLIContext): Command {
  return new Command("<name>")
    .description("<description>")
    .option("-f, --flag", "Some flag")
    .action(async (options) => {
      // SDK is automatically created and passed to myAction
      await runCommand(myAction, { requireAuth: true }, context);
    });
}
```

**Important**:
- Commands receive `sdk: Base44LocalProjectSDK` as first parameter
- The SDK is automatically created by `runCommand()` based on options
- Commands should NOT call `intro()` or `outro()` directly - `runCommand()` handles both
- Use `sdk.*` for all project operations (no direct imports from core)

### 2. Register in program.ts

```typescript
// src/cli/program.ts
import { getMyCommand } from "@/cli/commands/<domain>/<action>.js";

// Inside createProgram(context):
program.addCommand(getMyCommand(context));
```

### 3. Command wrapper options

```typescript
// Standard command - creates SDK from current directory
await runCommand(myAction, undefined, context);

// Command with full ASCII art banner (for special commands like create)
await runCommand(myAction, { fullBanner: true }, context);

// Command requiring authentication (auto-login if needed)
await runCommand(myAction, { requireAuth: true }, context);

// Command that doesn't need SDK (auth commands, create, link)
// These commands can use Base44LocalProjectSDK.auth.* or SDK.project.* static methods
await runCommand(myAction, { requireAppConfig: false }, context);

// Command with multiple options
await runCommand(myAction, { fullBanner: true, requireAuth: true }, context);
```

**Options:**
- `fullBanner`: Show ASCII art banner instead of simple tag
- `requireAuth`: Check authentication before running (uses SDK.auth.isLoggedIn())
- `requireAppConfig`: Create SDK from current directory (default: `true`)

### 4. CLIContext and Dependency Injection

The `CLIContext` type (`src/cli/types.ts`) provides dependencies to commands:

```typescript
export interface CLIContext {
  errorReporter: ErrorReporter;
  sdk: Base44LocalProjectSDK | null;  // Set by runCommand when requireAppConfig is true
}
```

- Created once in `runCLI()` at CLI startup with `sdk: null`
- `runCommand()` creates the SDK and sets `context.sdk`
- The SDK is passed to command action functions

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
theme.styles.dim(text)                    // Dimmed text

// Formatters (for error display)
theme.format.errorContext(ctx)            // Formats ErrorContext as dimmed pipe-separated string
theme.format.agentHints(hints)            // Formats ErrorHint[] as "[Agent Hints]\n  Run: ..."
```

When adding new theme properties, use semantic names (e.g., `links`, `header`) not color names.

## Using the SDK

Commands should use the SDK for all project operations. The SDK provides a clean, namespaced API.

### SDK in Commands

```typescript
// Commands receive sdk as first parameter (from runCommand)
async function myAction(sdk: Base44LocalProjectSDK): Promise<RunCommandResult> {
  // Entities
  const entities = await sdk.entities.readAll();
  await sdk.entities.push(entities);

  // Functions
  const functions = await sdk.functions.readAll();
  await sdk.functions.deploy(functions);

  // Agents
  const agents = await sdk.agents.readAll();
  await sdk.agents.push(agents);
  await sdk.agents.pull();  // Pull from remote

  // Site
  await sdk.site.deploy("dist");

  // Deploy all at once
  const result = await sdk.deployAll();
  console.log(result.appUrl);

  // Project config
  const { project, entities, functions, agents } = await sdk.project.readConfig();
}
```

### Static SDK Methods (No Project Needed)

For commands that don't need an existing project:

```typescript
// Authentication (always static)
await Base44LocalProjectSDK.auth.isLoggedIn();
await Base44LocalProjectSDK.auth.requireAuth();
await Base44LocalProjectSDK.auth.login();  // Returns device code info
await Base44LocalProjectSDK.auth.logout();
await Base44LocalProjectSDK.auth.getUser();

// Project creation and linking
const { projectId } = await Base44LocalProjectSDK.project.create({
  name: "my-app",
  path: "./my-app",
  template: template,
});
await Base44LocalProjectSDK.project.link(projectRoot, appId);
const root = await Base44LocalProjectSDK.project.findRoot();
```

### Direct API Calls (Advanced)

For operations not covered by SDK namespaces:

```typescript
import { base44Client } from "@/core/clients/index.js";

// For general Base44 API calls (authenticated)
const response = await base44Client.get("api/endpoint");
const data = await response.json();
```

## Adding a New Resource Type

Resources (entities, functions, agents) are managed via SDK namespaces. To add a new resource type:

### 1. Create resource folder

```
src/core/resources/<name>/
├── schema.ts    # Zod schemas for validation
├── config.ts    # readAll<Name>() - filesystem operations
├── api.ts       # API calls (accepts optional client param)
└── index.ts     # Barrel exports
```

### 2. Create SDK namespace

```typescript
// src/core/sdk/<name>-namespace.ts
export class <Name>Namespace {
  constructor(
    private config: SDKConfig,
    private client: AppClient
  ) {}

  async readAll(): Promise<T[]> { /* ... */ }
  async push(items: T[]): Promise<Response> { /* ... */ }
}
```

### 3. Add to SDK class

```typescript
// src/core/sdk/sdk.ts
private _<name>?: <Name>Namespace;

get <name>(): <Name>Namespace {
  if (!this._<name>) {
    this._<name> = new <Name>Namespace(this.config, this.getClient());
  }
  return this._<name>;
}
```

### 4. Update ProjectData type

Add the new resource array to `ProjectData` in `project/types.ts`.

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

The `base44 deploy` command deploys all project resources in one operation using the SDK:

1. Pushes entities (via `sdk.entities.push()`)
2. Pushes functions (via `sdk.functions.deploy()`)
3. Pushes agents (via `sdk.agents.push()`)
4. Deploys site (if `site.outputDirectory` is configured)

### Using SDK.deployAll()

```typescript
async function deployAction(sdk: Base44LocalProjectSDK): Promise<RunCommandResult> {
  // Check if there's anything to deploy
  if (!await sdk.hasResourcesToDeploy()) {
    return { outroMessage: "No resources found to deploy" };
  }

  // Deploy all resources
  const result = await sdk.deployAll();
  // result.entities, result.functions, result.agents, result.site, result.appUrl

  return { outroMessage: `Deployed to ${result.appUrl}` };
}
```

### Selective Deployment

```typescript
// Deploy only specific resource types
const result = await sdk.deployAll({
  entities: true,    // default: true
  functions: true,   // default: true
  agents: false,     // skip agents
  site: true,        // default: true if site config exists
});
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
// SDK (primary import for commands)
import { Base44LocalProjectSDK } from "@/core/index.js";
import type { Base44LocalProjectSDK } from "@/core/index.js";

// Low-level imports (for SDK internals or advanced use)
import { base44Client } from "@/core/clients/index.js";
import { readAllEntities } from "@/core/resources/entity/index.js";
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

### API Error Handling Pattern

When making HTTP requests with the ky client, use `ApiError.fromHttpError()` to convert HTTP errors to structured `ApiError` instances:

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

For status-specific handling (e.g., 428 for delete conflicts):

```typescript
import { HTTPError } from "ky";

try {
  response = await appClient.put("endpoint", { json: data });
} catch (error) {
  if (error instanceof HTTPError && error.response.status === 428) {
    throw new ApiError("Cannot delete: resource has dependencies", { statusCode: 428, cause: error });
  }
  throw await ApiError.fromHttpError(error, "performing action");
}
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

### Error Display

When an error is thrown, the CLI displays:

1. **Error message** - The main error text via `log.error()` (stack trace only with `DEBUG=1` env var)
2. **Agent Hints** (if hints exist) - Actionable suggestions for fixing the issue
3. **Error Context** - Dimmed outro line with session ID, app ID (if available), and timestamp

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

1. **Bun for development** - Use `bun` commands (not npm/yarn) for install, test, build during development
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
18. **Use SDK in commands** - Commands should use `sdk.*` for all project operations, not direct imports from core
19. **SDK for new features** - When adding new functionality, add it to the SDK namespace classes, not as standalone exports

## Development

```bash
bun install        # Install dependencies
bun run build      # bun build - bundles to dist/index.js + copies templates
bun run typecheck  # tsc --noEmit - type checking only
bun run dev        # runs ./bin/dev.ts (Bun runs TypeScript directly)
bun run start      # runs ./bin/run.js (production, requires build first)
bun run test       # Run tests with vitest (note: use `bun run test`, not `bun test`)
bun run lint       # Biome - linting, formatting, and import organization
bun run lint:fix   # Biome - auto-fix lint and format issues
```

### Debugging

To show full error stack traces, set the `DEBUG` environment variable:

```bash
DEBUG=1 base44 deploy    # Shows full stack trace on errors
```

### Entry Points Architecture

The CLI uses a split architecture for better development experience:

**Production** (`./bin/run.js`):
- Used when installed via npm (`base44` command)
- Uses `#!/usr/bin/env node` shebang for Node.js compatibility
- Imports from bundled `dist/index.js`
- Requires `bun run build` first

**Development** (`./bin/dev.ts`):
- Used during development (`bun run dev`)
- Uses `#!/usr/bin/env bun` shebang to run TypeScript directly
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
3. Commands throw errors → `runCommand()` catches, logs with `log.error()`, displays hints, re-throws
4. `runCLI()` catches errors, displays error details, reports to PostHog (if not CLIExitError)
5. Uses `process.exitCode = 1` (not `process.exit()`) to let event loop drain for telemetry
6. Telemetry can be disabled via `BASE44_DISABLE_TELEMETRY=1` environment variable
7. Telemetry includes `error_code` and `is_user_error` properties for all errors

### Prerequisites

- **Bun**: Install via `curl -fsSL https://bun.sh/install | bash`
- **Node.js >= 20.19.0**: Still needed for npm publishing (`.node-version` file provided)

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

**Build before testing**: Tests import the bundled `dist/index.js`, so run `bun run build && bun run test`.

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

### Test Overrides (`BASE44_CLI_TEST_OVERRIDES`)

The CLI uses a centralized JSON-based override mechanism for tests. When adding new testable behaviors that need mocking, **extend this existing mechanism** rather than creating new environment variables.

**Current overrides:**
- `appConfig` - Mock app configuration (id, projectRoot)
- `latestVersion` - Mock version check response (string for newer version, null for no update)

**Adding new overrides:**

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

**Why not vi.mock()?** Tests run against the bundled `dist/index.js` where path aliases are resolved. `vi.mock("@/some/path.js")` won't match the bundled code.

### Testing Rules

1. **Build first** - Run `bun run build` before `bun test`
2. **Use fixtures** - Don't create project structures in tests
3. **Fixtures need `.app.jsonc`** - Add `base44/.app.jsonc` with `{ "id": "test-app-id" }`
4. **Interactive prompts can't be tested** - Only test via non-interactive flags
5. **Use test overrides** - Extend `BASE44_CLI_TEST_OVERRIDES` for new testable behaviors; don't create new env vars
