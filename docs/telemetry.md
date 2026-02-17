# Telemetry & Error Reporting

**Keywords:** telemetry, PostHog, ErrorReporter, captureException, session, disable telemetry, BASE44_DISABLE_TELEMETRY

The CLI reports errors to PostHog for monitoring. This is handled by the `ErrorReporter` class in `src/cli/telemetry/`.

## Architecture

```
src/cli/telemetry/
├── consts.ts           # PostHog API key, env var names
├── posthog.ts          # PostHog client singleton
├── error-reporter.ts   # ErrorReporter class
├── commander-hooks.ts  # Adds command info to error context
└── index.ts            # Barrel exports
```

## ErrorReporter Lifecycle

The `ErrorReporter` is created once in `runCLI()` and injected via `CLIContext`:

```typescript
// In runCLI() - creates and injects the reporter
const errorReporter = new ErrorReporter();
errorReporter.registerProcessErrorHandlers();
const isNonInteractive = !process.stdin.isTTY || !process.stdout.isTTY;
const context: CLIContext = { errorReporter, isNonInteractive };
const program = createProgram(context);

// Context is set throughout execution
errorReporter.setContext({ user: { email, name } });
errorReporter.setContext({ appId: "..." });
errorReporter.setContext({ command: { name, args, options } });

// Errors are captured automatically in runCLI's catch block
errorReporter.captureException(error);
```

## What's Captured

- Session ID and duration
- User email (if logged in)
- Command name, args, and options
- App ID (if in a project)
- System info (Node version, OS, platform)
- Error stack traces
- Error code and `isUserError` (for `CLIError` instances)

## Disabling Telemetry

Set the environment variable:

```bash
BASE44_DISABLE_TELEMETRY=1
```

## Integration with Error Flow

1. `runCLI()` creates `ErrorReporter` and registers process error handlers
2. `createProgram(context)` builds the command tree with injected context
3. Commands throw errors -- `runCommand()` catches, logs with `log.error()`, displays hints, re-throws
4. `runCLI()` catches errors, reports to PostHog (if not `CLIExitError`)
5. Uses `process.exitCode = 1` (not `process.exit()`) to let event loop drain for telemetry flush
