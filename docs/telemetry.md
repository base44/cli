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

### Redaction

Sensitive values are redacted before capture (`src/cli/telemetry/redact.ts`):

- Positional args shaped like `KEY=VALUE` (e.g. `base44 secrets set FOO=bar`)
  keep the key but the value is replaced with `[REDACTED]`
- API request/response bodies for `/secrets` endpoints are replaced entirely
  with `[REDACTED]`

Anything new that may carry user secrets (args, request bodies, options) must
go through these helpers before being added to event properties.

## First-Run Notice

`runCLI()` calls `maybeShowTelemetryNotice(log)` (in
`src/cli/telemetry/first-run-notice.ts`), which prints a one-time notice about
what is collected and how to opt out. A marker file at
`~/.base44/telemetry-notice` records that the notice was shown. The notice is
skipped when telemetry is disabled (the testkit disables it for all tests).

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
