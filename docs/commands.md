# Adding & Modifying CLI Commands

**Keywords:** command, factory pattern, Base44Command, isNonInteractive, runTask, spinner, theming, chalk, program.ts, register, banner, intro, outro

Commands live in `src/cli/commands/<domain>/`. They use a **factory pattern** — each file exports a function that returns a `Base44Command`.

## Command File Template

```typescript
// src/cli/commands/<domain>/<action>.ts
import { log } from "@clack/prompts";
import type { Command } from "commander";
import type { RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask, theme } from "@/cli/utils/index.js";

async function myAction(): Promise<RunCommandResult> {
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

  log.success("Operation completed!");

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

## Base44Command Options

Pass options as the second argument to the constructor:

```typescript
new Base44Command("my-cmd")                                         // All defaults
new Base44Command("my-cmd", { requireAuth: false })                 // Skip auth check
new Base44Command("my-cmd", { requireAppConfig: false })            // Skip app config loading
new Base44Command("my-cmd", { fullBanner: true })                   // ASCII art banner
new Base44Command("my-cmd", { requireAuth: false, requireAppConfig: false })
```

| Option | Default | Description |
|--------|---------|-------------|
| `requireAuth` | `true` | Check authentication before running, auto-triggers login if needed |
| `requireAppConfig` | `true` | Load `.app.jsonc` and cache for sync access via `getAppConfig()` |
| `fullBanner` | `false` | Show ASCII art banner instead of simple intro tag |

When the CLI runs in non-interactive mode (CI, piped output), all clack UI (intro, outro, themed errors) is automatically skipped. Errors go to stderr as plain text.

## Registering a Command

Add the import and registration in `src/cli/program.ts`:

```typescript
import { getMyCommand } from "@/cli/commands/<domain>/<action>.js";

// Inside createProgram(context):
program.addCommand(getMyCommand());
```

## CLIContext (Automatic Injection)

```typescript
export interface CLIContext {
  errorReporter: ErrorReporter;
  isNonInteractive: boolean;
  distribution: Distribution;
}
```

- Created once in `runCLI()` at startup
- `isNonInteractive` is `true` when stdin/stdout are not a TTY (e.g., CI, piped output, AI agents). Controls quiet mode — when true, all clack UI is suppressed.

### Using `isNonInteractive`

When a command needs to check `isNonInteractive` (e.g., to skip browser opens or confirmation prompts), access it from the command instance. Commander passes the command as the last argument to action handlers:

```typescript
export function getMyCommand(): Command {
  return new Base44Command("open")
    .description("Open something in browser")
    .action(async (_options: unknown, command: Base44Command) => {
      return await myAction(command.isNonInteractive);
    });
}

async function myAction(isNonInteractive: boolean): Promise<RunCommandResult> {
  if (!isNonInteractive) {
    await open(url); // Only open browser in interactive mode
  }
  return { outroMessage: `Opened at ${url}` };
}
```

### Guarding Interactive Commands

Commands that use interactive prompts (`select`, `text`, `confirm`, `group` from `@clack/prompts`) **must** guard against non-interactive environments. If the user didn't provide enough flags to skip all prompts, error early:

```typescript
export function getMyCommand(): Command {
  return new Base44Command("my-cmd", { requireAppConfig: false })
    .option("-n, --name <name>", "Project name")
    .option("-p, --path <path>", "Project path")
    .action(async (options: MyOptions, command: Base44Command) => {
      const skipPrompts = !!options.name && !!options.path;
      if (!skipPrompts && command.isNonInteractive) {
        throw new InvalidInputError(
          "--name and --path are required in non-interactive mode",
        );
      }
      if (skipPrompts) {
        return await createNonInteractive(options);
      }
      return await createInteractive(options);
    });
}
```

Commands that only use `log.*` (display-only, no input) don't need this guard. See `project/create.ts`, `project/link.ts`, and `project/eject.ts` for real examples.

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

Avoid manual try/catch with `log.message` for async operations -- use `runTask()` instead.

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
    .action(async (entries, options) => {
      return await myAction(entries, options);
    });
}
```

Access `command.args` for positional arguments and `command.opts()` for options inside the hook. See `secrets/set.ts` and `project/create.ts` for real examples.

## Rules (Command-Specific)

- **Command factory pattern** - Commands export `getXCommand()` functions (no parameters), not static instances
- **Use `Base44Command`** - All commands use `new Base44Command(name, options?)`
- **No context plumbing** - Context is injected automatically. Command files should never import `CLIContext`.
- **Task wrapper** - Use `runTask()` for async operations with spinners
- **Use theme for styling** - Never use `chalk` directly; import `theme` from `@/cli/utils/` and use semantic names
- **Use fs.ts utilities** - Always use `@/core/utils/fs.js` for file operations
- **Guard interactive prompts** - Commands using `select`, `text`, `confirm`, or `group` from `@clack/prompts` must check `command.isNonInteractive` and throw `InvalidInputError` if required flags are missing. Never let prompts hang in CI.
- **Consistent copy across related commands** - User-facing messages (errors, success, hints) for commands in the same group should use consistent language and structure. When writing validation errors, outro messages, or spinner text, check sibling commands for parity so the product voice stays coherent.
