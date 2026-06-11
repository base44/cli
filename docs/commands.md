# Adding & Modifying CLI Commands

**Keywords:** command, factory pattern, Base44Command, CLIContext, Logger, runTask, spinner, theming, chalk, program.ts, register, banner, intro, outro

Commands live in `src/cli/commands/<domain>/`. They use a **factory pattern** — each file exports a function that returns a `Base44Command`.

## Command File Template

```typescript
// src/cli/commands/<domain>/<action>.ts
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask, theme } from "@/cli/utils/index.js";

async function myAction({ logger }: CLIContext): Promise<RunCommandResult> {
  const result = await runTask(
    "Doing something...",
    async () => {
      // Your async operation here
      return someResult;
    },
    {
      successMessage: theme.colors.base44Orange("Done!"),
      errorMessage: "Failed to do something",
    }
  );

  logger.success("Operation completed!");

  return { outroMessage: `Created ${theme.styles.bold(result.name)}` };
}

export function getMyCommand(): Command {
  return new Base44Command("<name>")
    .description("<description>")
    .option("-f, --flag", "Some flag")
    .action(myAction);
}
```

**Key rules**:
- Export a **factory function** (`getMyCommand`), not a static command instance
- Use `Base44Command` class
- Commands must NOT call `intro()` or `outro()` directly
- The action function must return `RunCommandResult` with an `outroMessage`
- Action functions receive `CLIContext` as their first argument (injected by `Base44Command`), followed by Commander's positional args and options
- Destructure what you need from `CLIContext`: `{ logger }`, `{ logger, isNonInteractive }`, or `_ctx` if nothing needed
- Use `.action(fn)` directly — no wrapper needed

## Base44Command Options

Pass options as the second argument to the constructor:

```typescript
new Base44Command("my-cmd")                                         // All defaults
new Base44Command("my-cmd", { requireAuth: false })                 // Skip auth check
new Base44Command("my-cmd", { requireAppContext: false })            // Skip app context resolution
new Base44Command("my-cmd", { fullBanner: true })                   // ASCII art banner
new Base44Command("my-cmd", { requireAuth: false, requireAppContext: false })
```

| Option | Default | Description |
|--------|---------|-------------|
| `requireAuth` | `true` | Check authentication before running, auto-triggers login if needed |
| `requireAppContext` | `true` | Resolve the app ID from `--app-id`, `BASE44_APP_ID`, or `.app.jsonc`, then cache it for sync access via `getAppContext()` |
| `fullBanner` | `false` | Show ASCII art banner instead of simple intro tag |

`BASE44_APP_ID` is bound to the global `--app-id` option in `src/cli/program.ts`; Commander resolves it before `Base44Command` calls `initAppContext({ appId })`.

When the CLI runs in non-interactive mode (CI, piped output), all clack UI (intro, outro, themed errors) is automatically skipped. Errors go to stderr as plain text.

## Registering a Command

Add the import and registration in `src/cli/program.ts`:

```typescript
import { getMyCommand } from "@/cli/commands/<domain>/<action>.js";

// Inside createProgram(context):
program.addCommand(getMyCommand());
```

## CLIContext (Automatic Injection)

`CLIContext` is automatically injected as the **first argument** to all action functions by `Base44Command`. Destructure what you need:

```typescript
export interface CLIContext {
  errorReporter: ErrorReporter;
  isNonInteractive: boolean;
  distribution: Distribution;
  logger: Logger;
  app?: {
    id: string;
    projectRoot?: string;
  };
}
```

- Created once in `runCLI()` at startup
- `isNonInteractive` is `true` when stdin/stdout are not a TTY (e.g., CI, piped output, AI agents). Controls quiet mode — when true, all clack UI is suppressed.
- `logger` is a `Logger` instance — `ClackLogger` in interactive mode, `SimpleLogger` in non-interactive mode.
- `app` is set for commands with `requireAppContext: true`. Use `app.id` for the active app and `app.projectRoot` only when a local project was resolved.

### Using `isNonInteractive`

Destructure `isNonInteractive` from the context first argument:

```typescript
async function openDashboard({ isNonInteractive }: CLIContext): Promise<RunCommandResult> {
  if (!isNonInteractive) {
    await open(url); // Only open browser in interactive mode
  }
  return { outroMessage: `Opened at ${url}` };
}

export function getMyCommand(): Command {
  return new Base44Command("open")
    .description("Open something in browser")
    .action(openDashboard);
}
```

### Guarding Interactive Commands

Commands that use interactive prompts (`select`, `text`, `confirm`, `group` from `@clack/prompts`) **must** guard against non-interactive environments. Move the guard into the action function:

```typescript
async function myAction(
  { isNonInteractive }: CLIContext,
  options: MyOptions,
): Promise<RunCommandResult> {
  const skipPrompts = !!options.name && !!options.path;
  if (!skipPrompts && isNonInteractive) {
    throw new InvalidInputError(
      "--name and --path are required in non-interactive mode",
    );
  }
  if (skipPrompts) {
    return await createNonInteractive(options);
  }
  return await createInteractive(options);
}

export function getMyCommand(): Command {
  return new Base44Command("my-cmd", { requireAppContext: false })
    .option("-n, --name <name>", "Project name")
    .option("-p, --path <path>", "Project path")
    .action(myAction);
}
```

Commands that only use `logger.*` (display-only, no input) don't need this guard. See `project/create.ts`, `project/scaffold.ts`, `project/link.ts`, and `project/eject.ts` for real examples.

`project/create.ts` and `project/scaffold.ts` share their post-scaffold logic (push entities, deploy site, install skills, print summary) via `project/scaffold-shared.ts` — `create` mints a new app and rejects `--app-id`/`BASE44_APP_ID`, while `scaffold` reuses an existing app id (from `--app-id` or `BASE44_APP_ID`).

## runTask (Async Operations with Spinners)

Use `runTask()` for any async operation that takes time:

```typescript
const result = await runTask(
  "Deploying site...",
  async () => {
    return await deploySite(outputDir);
  },
  {
    successMessage: theme.colors.base44Orange("Site deployed!"),
    errorMessage: "Failed to deploy site",
  }
);
```

Avoid manual try/catch with `logger.message` for async operations -- use `runTask()` instead.

### Subprocess Logging

When running subprocesses inside `runTask()`, use `{ shell: true }` without `stdio: "inherit"` to suppress subprocess output. The spinner provides user feedback.

```typescript
await runTask("Installing...", async () => {
  await execa("npx", ["-y", "some-package"], {
    cwd: targetPath,
    shell: true,
  });
});
```

## Theming

All CLI styling is centralized in `src/cli/utils/theme.ts`. **Never use `chalk` directly.**

```typescript
import { theme } from "@/cli/utils/index.js";

// Colors
theme.colors.base44Orange("Success!")     // Primary brand color
theme.colors.links(url)                   // URLs and links

// Styles
theme.styles.bold(email)                  // Bold emphasis
theme.styles.header("Label")              // Dim text for labels
theme.styles.dim(text)                    // Dimmed text

// Formatters (for error display)
theme.format.errorContext(ctx)            // Dimmed pipe-separated context string
theme.format.agentHints(hints)            // "[Agent Hints]\n  Run: ..."
```

When adding new theme properties, use **semantic names** (e.g., `links`, `header`) not color names.

## Input Validation with Commander Hooks

Use `.hook("preAction", validator)` to validate command input (required args, mutually exclusive options) **before** the action runs. This keeps validation separate from business logic.

```typescript
function validateInput(command: Command): void {
  const { flagA, flagB } = command.opts<MyOptions>();
  if (!command.args.length && !flagA) {
    throw new InvalidInputError("Provide args or use --flag-a.");
  }
  if (command.args.length > 0 && flagA) {
    throw new InvalidInputError("Provide args or --flag-a, but not both.");
  }
}

export function getMyCommand(): Command {
  return new Base44Command("my-cmd")
    .argument("[entries...]", "Input entries")
    .option("--flag-a <value>", "Alternative input")
    .hook("preAction", validateInput)
    .action(myAction);
}
```

Access `command.args` for positional arguments and `command.opts()` for options inside the hook. See `secrets/set.ts` and `project/create.ts` for real examples.

## Rules (Command-Specific)

- **Command factory pattern** - Commands export `getXCommand()` functions (no parameters), not static instances
- **Use `Base44Command`** - All commands use `new Base44Command(name, options?)`
- **CLIContext as first arg** - All action functions receive `CLIContext` as their first argument (auto-injected). Destructure `{ logger }`, `{ logger, isNonInteractive }`, or use `_ctx` if nothing is needed. Use `.action(fn)` directly — no wrappers.
- **Use `logger` for output** - Never import `log` from `@clack/prompts` in command files. Use the `logger` from CLIContext so output works correctly in both interactive and non-interactive modes. Pass `logger` to helper functions as a parameter.
- **Task wrapper** - Use `runTask()` for async operations with spinners
- **Use theme for styling** - Never use `chalk` directly; import `theme` from `@/cli/utils/` and use semantic names
- **Use fs.ts utilities** - Always use `@/core/utils/fs.js` for file operations
- **Guard interactive prompts** - Commands using `select`, `text`, `confirm`, or `group` from `@clack/prompts` must check `isNonInteractive` (from CLIContext) and throw `InvalidInputError` if required flags are missing. Never let prompts hang in CI.
- **Consistent copy across related commands** - User-facing messages (errors, success, hints) for commands in the same group should use consistent language and structure. When writing validation errors, outro messages, or spinner text, check sibling commands for parity so the product voice stays coherent.
