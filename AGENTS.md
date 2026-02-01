# AI Agent Guidelines for Base44 CLI Development

This document provides essential context and guidelines for AI agents working on the Base44 CLI project.

Keep this file updated when making significant architectural changes.

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
├── bin/
│   ├── run.js
│   └── dev.js
├── src/
│   ├── core/
│   │   ├── api/
│   │   │   ├── oauth-client.ts
│   │   │   ├── base44-client.ts
│   │   │   └── index.ts
│   │   ├── auth/
│   │   │   ├── api.ts
│   │   │   ├── schema.ts
│   │   │   ├── config.ts
│   │   │   └── index.ts
│   │   ├── project/
│   │   │   ├── config.ts
│   │   │   ├── schema.ts
│   │   │   ├── api.ts
│   │   │   ├── create.ts
│   │   │   ├── deploy.ts
│   │   │   ├── template.ts
│   │   │   ├── app-config.ts
│   │   │   └── index.ts
│   │   ├── resources/
│   │   │   ├── types.ts
│   │   │   ├── entity/
│   │   │   ├── function/
│   │   │   ├── agent/
│   │   │   └── index.ts
│   │   ├── site/
│   │   │   ├── schema.ts
│   │   │   ├── config.ts
│   │   │   ├── api.ts
│   │   │   ├── deploy.ts
│   │   │   └── index.ts
│   │   ├── utils/
│   │   │   ├── fs.ts
│   │   │   └── index.ts
│   │   ├── consts.ts
│   │   ├── config.ts
│   │   ├── errors.ts
│   │   └── index.ts
│   └── cli/
│       ├── program.ts
│       ├── index.ts
│       ├── types.ts
│       ├── errors.ts
│       ├── commands/
│       │   ├── auth/
│       │   ├── project/
│       │   ├── entities/
│       │   ├── agents/
│       │   ├── functions/
│       │   └── site/
│       ├── telemetry/
│       │   ├── consts.ts
│       │   ├── posthog.ts
│       │   ├── error-reporter.ts
│       │   ├── commander-hooks.ts
│       │   └── index.ts
│       └── utils/
│           ├── runCommand.ts
│           ├── runTask.ts
│           ├── banner.ts
│           ├── prompts.ts
│           ├── theme.ts
│           ├── urls.ts
│           └── index.ts
├── templates/
├── tests/
├── dist/
├── package.json
└── tsconfig.json
```

## Adding a New Command

Commands live in `src/cli/commands/` and use a **factory pattern** with dependency injection via `CLIContext`.

### Steps

1. Create command file in `src/cli/commands/<domain>/<action>.ts`
2. Export factory function `getMyCommand(context: CLIContext)` that returns a `Command`
3. Register in `program.ts` using `program.addCommand(getMyCommand(context))`
4. Use `runCommand(actionFn, options, context)` wrapper in command action
5. Use `runTask()` for async operations with spinners

### Key Patterns

- Commands export factory functions, not static instances
- Factory receives `CLIContext` which contains `errorReporter`
- Commands should NOT call `intro()` or `outro()` - `runCommand()` handles both
- Pass `context` to `runCommand()` as third argument

### runCommand Options

```typescript
// Standard command - loads app config by default
await runCommand(myAction, undefined, context);

// With full ASCII art banner
await runCommand(myAction, { fullBanner: true }, context);

// Requiring authentication
await runCommand(myAction, { requireAuth: true }, context);

// Without app config loading
await runCommand(myAction, { requireAppConfig: false }, context);
```

Options:
- `fullBanner`: Show ASCII art banner instead of simple tag
- `requireAuth`: Check authentication before running (auto-login if needed)
- `requireAppConfig`: Load `.app.jsonc` and cache for sync access (default: `true`)

### CLIContext

The `CLIContext` type provides dependencies to commands:

```typescript
export interface CLIContext {
  errorReporter: ErrorReporter;
}
```

Created once in `runCLI()`, passed to `createProgram(context)`, then to each command factory.

## Theming

All CLI styling is centralized in `src/cli/utils/theme.ts`. Never use `chalk` directly.

```typescript
import { theme } from "@/cli/utils/index.js";

// Colors
theme.colors.base44Orange("Success!")
theme.colors.links(url)

// Styles
theme.styles.bold(text)
theme.styles.header("Label")
theme.styles.dim(text)

// Formatters
theme.format.errorContext(ctx)
theme.format.agentHints(hints)
```

## Making API Calls

Use HTTP clients from `@/core/api/index.js`:

### Authenticated Calls

Use `base44Client` for authenticated calls or `getAppClient()` for app-specific endpoints.

### OAuth Endpoints

Use `oauthClient` only in `auth/api.ts` for device code flow.

### Token Refresh

The `base44Client` automatically handles token refresh before requests and on 401 responses.

## Resource Pattern

Resources are project-specific collections (entities, functions) that can be loaded from the filesystem.

### Resource Interface

```typescript
export interface Resource<T> {
  readAll: (dir: string) => Promise<T[]>;
  push: (items: T[]) => Promise<unknown>;
}
```

The `push` method handles empty arrays gracefully (returns early without API call).

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

The site module (`src/core/site/`) handles deploying built frontend files to Base44 hosting. Unlike Resources, the site module reads built artifacts from the output directory, creates a tar.gz archive, and uploads to the API.

Key function:

```typescript
import { deploySite } from "@/core/site/index.js";
const { appUrl } = await deploySite("./dist");
```

## Unified Deploy Command

The `base44 deploy` command deploys all project resources:

1. Pushes entities (via `entityResource.push()`)
2. Pushes functions (via `functionResource.push()`)
3. Deploys site (if `site.outputDirectory` is configured)

```typescript
import { deployAll, hasResourcesToDeploy } from "@/core/project/index.js";

if (!hasResourcesToDeploy(projectData)) {
  return;
}

const { appUrl } = await deployAll(projectData);
```

## Path Aliases

Single alias defined in `tsconfig.json`:
- `@/*` → `./src/*`

## Error Handling

The CLI uses a structured error hierarchy for clear, actionable error messages.

### Error Hierarchy

```
CLIError (abstract base class)
├── UserError (user did something wrong - fixable by user)
│   ├── AuthRequiredError
│   ├── AuthExpiredError
│   ├── ConfigNotFoundError
│   ├── ConfigInvalidError
│   ├── ConfigExistsError
│   ├── SchemaValidationError
│   └── InvalidInputError
│
└── SystemError (something broke - needs investigation)
    ├── ApiError
    ├── FileNotFoundError
    ├── FileReadError
    └── InternalError
```

### Error Properties

All errors extend `CLIError`:

```typescript
interface CLIError {
  code: string;
  isUserError: boolean;
  hints: ErrorHint[];
  cause?: Error;
}

interface ErrorHint {
  message: string;
  command?: string;
}
```

### Throwing Errors

Import from `@/core/errors.js`:

```typescript
import {
  ConfigNotFoundError,
  InvalidInputError,
  ApiError,
} from "@/core/errors.js";

throw new ConfigNotFoundError();

throw new InvalidInputError(`Template "${templateId}" not found`, {
  hints: [{ message: `Use one of: ${validIds}` }],
});

throw new ApiError("Failed to sync entities", { statusCode: response.status });
```

### API Error Handling Pattern

Use `ApiError.fromHttpError()` to convert HTTP errors:

```typescript
import { ApiError } from "@/core/errors.js";

try {
  response = await appClient.put("endpoint", { json: data });
} catch (error) {
  throw await ApiError.fromHttpError(error, "performing action");
}
```

### SchemaValidationError with Zod

Pass context message and `ZodError`:

```typescript
import { SchemaValidationError } from "@/core/errors.js";

const result = EntitySchema.safeParse(parsed);

if (!result.success) {
  throw new SchemaValidationError("Invalid entity file at " + entityPath, result.error);
}
```

Do NOT manually call `z.prettifyError()` - the class does this internally.

### CLIExitError (Special Case)

`CLIExitError` in `src/cli/errors.ts` is for controlled exits (e.g., user cancellation). It's NOT reported to telemetry:

```typescript
import { CLIExitError } from "@/cli/errors.js";

throw new CLIExitError(0);
```

## Telemetry & Error Reporting

The CLI reports errors to PostHog via the `ErrorReporter` class.

Created once in `runCLI()`, injected via `CLIContext`:

```typescript
const errorReporter = new ErrorReporter();
errorReporter.registerProcessErrorHandlers();
const context: CLIContext = { errorReporter };
```

### Disabling Telemetry

Set environment variable: `BASE44_DISABLE_TELEMETRY=1`

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
12. **Use theme for styling** - Never use `chalk` directly; import `theme` from utils
13. **Use fs.ts utilities** - Always use `@/core/utils/fs.js` for file operations
14. **No direct process.exit()** - Throw `CLIExitError` instead
15. **Use structured errors** - Never `throw new Error()`; use specific error classes from `@/core/errors.js`
16. **SchemaValidationError requires ZodError** - Always pass `ZodError`, don't call `z.prettifyError()` manually
17. **No dynamic imports** - Avoid `await import()`; use static imports at top of file

## Development

```bash
npm run build      # tsdown - bundles to dist/index.js
npm run typecheck  # tsc --noEmit
npm run dev        # runs ./bin/dev.js (tsx for TypeScript)
npm run start      # runs ./bin/run.js (requires build first)
npm test           # vitest
npm run lint       # eslint
```

### Debugging

Show full error stack traces:

```bash
DEBUG=1 base44 deploy
```

### Entry Points

**Production** (`./bin/run.js`):
- Used when installed via npm
- Imports bundled `dist/index.js`
- Requires `npm run build` first

**Development** (`./bin/dev.js`):
- Used during development (`npm run dev`)
- Uses `tsx` to run TypeScript directly from `src/cli/index.ts`
- No build step required

**Error Handling Flow**:
1. `runCLI()` creates `ErrorReporter` and registers process error handlers
2. `createProgram(context)` builds command tree with injected context
3. Commands throw errors → `runCommand()` catches, logs, displays hints, re-throws
4. `runCLI()` catches errors, displays details, reports to PostHog (if not CLIExitError)
5. Uses `process.exitCode = 1` (not `process.exit()`) to let event loop drain
6. Telemetry includes `error_code` and `is_user_error` properties

### Node.js Version

Requires Node.js >= 20.19.0. A `.node-version` file is provided for fnm/nodenv.

### CLI Utilities

Use `runTask()` from `src/cli/utils/runTask.ts` for async operations with progress feedback.

### Subprocess Logging

When running subprocesses with `execa` inside `runTask()`, use `{ shell: true }` without `stdio: "inherit"` to suppress subprocess output:

```typescript
await runTask("Installing...", async () => {
  await execa("npx", ["-y", "some-package"], {
    cwd: targetPath,
    shell: true
  });
});
```

## Testing

Tests require `npm run build` first. See [TESTING.md](./TESTING.md) for details.
