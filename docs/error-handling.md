# Error Handling

**Keywords:** error, CLIError, UserError, SystemError, ApiError, hints, SchemaValidationError, CLIExitError, error code, process.exit

The CLI uses a structured error hierarchy to provide clear, actionable error messages with hints for users and AI agents. All error classes live in `src/core/errors.ts`.

## Error Hierarchy

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

## Error Properties

All errors extend `CLIError`:

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

## Throwing Errors

Import from `@/core/errors.js`:

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
// 401 → auto-hints to run `base44 login`
// 404 → hints about resource not found
// Other → hints to check network
```

## SchemaValidationError with Zod

Requires a context message and a `ZodError`. Formats the error automatically using `z.prettifyError()`:

```typescript
import { SchemaValidationError } from "@/core/errors.js";

const result = EntitySchema.safeParse(parsed);

if (!result.success) {
  throw new SchemaValidationError("Invalid entity file at " + entityPath, result.error);
}

// Output:
// Invalid entity file at /path/to/entity.jsonc:
// ✖ Invalid input: expected string, received number
//   → at name
```

**Important**: Do NOT manually call `z.prettifyError()` -- the class does this internally.

## API Error Handling Pattern

See [api-patterns.md](api-patterns.md) for the full `ApiError.fromHttpError()` pattern used when making HTTP requests.

## Error Code Reference

| Code | Class | When to use |
| ---- | ----- | ----------- |
| `AUTH_REQUIRED` | `AuthRequiredError` | User not logged in |
| `AUTH_EXPIRED` | `AuthExpiredError` | Token expired, needs re-login |
| `CONFIG_NOT_FOUND` | `ConfigNotFoundError` | No project/config file found |
| `CONFIG_INVALID` | `ConfigInvalidError` | Config file has invalid content |
| `CONFIG_EXISTS` | `ConfigExistsError` | Project already exists at location |
| `SCHEMA_INVALID` | `SchemaValidationError` | Zod validation failed |
| `INVALID_INPUT` | `InvalidInputError` | User provided invalid input |
| `API_ERROR` | `ApiError` | API request failed |
| `FILE_NOT_FOUND` | `FileNotFoundError` | File doesn't exist |
| `FILE_READ_ERROR` | `FileReadError` | Can't read/write file |
| `INTERNAL_ERROR` | `InternalError` | Unexpected error |
| `TYPE_GENERATION_ERROR` | `TypeGenerationError` | Type generation failed for entity |
| `DEPENDENCY_NOT_FOUND` | `DependencyNotFoundError` | Required external tool not installed |

## CLIExitError (Special Case)

`CLIExitError` in `src/cli/errors.ts` is for **controlled exits** (e.g., user cancellation). It is NOT reported to telemetry:

```typescript
import { CLIExitError } from "@/cli/errors.js";

throw new CLIExitError(0);  // Exit code 0 = success (user chose to cancel)
```

## Error Display Flow

When an error is thrown in a command:

1. `runCommand()` catches it, logs via `log.error()`, displays agent hints, re-throws
2. `runCLI()` catches it, reports to PostHog (unless `CLIExitError`), sets `process.exitCode = 1`
3. Uses `process.exitCode` (not `process.exit()`) to let the event loop drain for telemetry

The display includes:
- **Error message** via `log.error()` (full stack trace only with `DEBUG=1`)
- **Agent Hints** (if hints exist) -- actionable suggestions
- **Error Context** -- dimmed outro line with session ID, app ID, and timestamp

## Rules (Error-Specific)

- **No direct process.exit()** - Throw `CLIExitError` instead; entry points handle the exit
- **Use structured errors** - Never `throw new Error()`; use specific classes from `@/core/errors.js` with hints
- **SchemaValidationError requires ZodError** - Pass `ZodError`: `new SchemaValidationError("context", result.error)` -- do NOT call `z.prettifyError()` manually
