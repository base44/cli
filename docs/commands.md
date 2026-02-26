# Adding & Modifying CLI Commands

**Keywords:** command, factory pattern, CLIContext, isNonInteractive, isJsonMode, runCommand, runTask, spinner, theming, chalk, program.ts, register, banner, intro, outro, json, --json, data, piping

Commands live in `src/cli/commands/<domain>/`. They use a **factory pattern** with dependency injection via `CLIContext`.

## Command File Template

```typescript
// src/cli/commands/<domain>/<action>.ts
import { Command } from "commander";
import { log } from "@clack/prompts";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

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

export function getMyCommand(context: CLIContext): Command {
  return new Command("<name>")
    .description("<description>")
    .option("-f, --flag", "Some flag")
    .action(async (options) => {
      await runCommand(myAction, { requireAuth: true }, context);
    });
}
```

**Key rules**:
- Export a **factory function** (`getMyCommand`), not a static command instance
- The factory receives `CLIContext` (contains `errorReporter` and `isNonInteractive`)
- Commands must NOT call `intro()` or `outro()` directly -- `runCommand()` handles both
- Always pass `context` as the third argument to `runCommand()`

## Registering a Command

Add the import and registration in `src/cli/program.ts`:

```typescript
import { getMyCommand } from "@/cli/commands/<domain>/<action>.js";

// Inside createProgram(context):
program.addCommand(getMyCommand(context));
```

## runCommand Options

```typescript
await runCommand(myAction, undefined, context);                          // Standard (loads app config)
await runCommand(myAction, { fullBanner: true }, context);               // ASCII art banner
await runCommand(myAction, { requireAuth: true }, context);              // Auto-login if needed
await runCommand(myAction, { requireAppConfig: false }, context);        // Skip app config loading
await runCommand(myAction, { fullBanner: true, requireAuth: true }, context);
```

- `fullBanner` - Show ASCII art banner instead of simple tag (for special commands like `create`)
- `requireAuth` - Check authentication before running, auto-triggers login if needed
- `requireAppConfig` - Load `.app.jsonc` and cache for sync access (default: `true`)

## CLIContext (Dependency Injection)

```typescript
export interface CLIContext {
  errorReporter: ErrorReporter;
  isNonInteractive: boolean;
  isJsonMode: boolean;
}
```

- Created once in `runCLI()` at startup
- `isNonInteractive` is `true` when stdin/stdout are not a TTY (e.g., CI, piped output, AI agents). Use it to skip interactive prompts, browser opens, and animations.
- `isJsonMode` is set by the global `--json` flag via a `preAction` hook. Commands don't need to check it directly -- `runCommand` handles all mode-switching.
- Passed to `createProgram(context)`, which passes it to each command factory
- Commands pass it to `runCommand()` for error reporting integration

### Using `isNonInteractive`

Pass `context.isNonInteractive` to your action when the command has interactive behavior (browser opens, confirmation prompts, animations):

```typescript
export function getMyCommand(context: CLIContext): Command {
  return new Command("open")
    .description("Open something in browser")
    .action(async () => {
      await runCommand(
        () => myAction(context.isNonInteractive),
        { requireAuth: true },
        context,
      );
    });
}

async function myAction(isNonInteractive: boolean): Promise<RunCommandResult> {
  if (!isNonInteractive) {
    await open(url); // Only open browser in interactive mode
  }
  return { outroMessage: `Opened at ${url}` };
}
```

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

export function getMyCommand(context: CLIContext): Command {
  return new Command("my-cmd")
    .argument("[entries...]", "Input entries")
    .option("--flag-a <value>", "Alternative input")
    .hook("preAction", validateInput)
    .action(async (entries, options) => {
      await runCommand(() => myAction(entries, options), { requireAuth: true }, context);
    });
}
```

Access `command.args` for positional arguments and `command.opts()` for options inside the hook. See `secrets/set.ts` and `project/create.ts` for real examples.

## JSON Mode (`--json`)

The CLI supports a global `--json` flag that outputs structured JSON instead of human-readable text. This enables piping output to tools like `jq`:

```bash
base44 logs --function my-fn --json | jq '.logs[] | .message'
```

### How it works

When `--json` is set, `runCommand` mutes `process.stdout.write` before calling `commandFn()`. This silences all clack output (intro, outro, `log.*`, spinners) automatically. Only the serialized `result.data` is written to stdout. Errors are written to stderr as JSON.

### Adding JSON support to a command

Return a `data` field from your action. Always use a top-level object (wrap arrays):

```typescript
async function listAction(): Promise<RunCommandResult> {
  const items = await fetchItems();

  return {
    outroMessage: `Found ${items.length} items`,
    stdout: formatItems(items),       // human mode
    data: { items },                  // json mode: { "items": [...] }
  };
}
```

- `data` is `Record<string, unknown>` -- always an object, never a raw array
- If `data` is not set, `runCommand` falls back to `{ "message": outroMessage }`
- Commands need zero changes to be silenced -- the stdout muting handles `log.*` and spinners

### Error format

On error in JSON mode, a JSON object is written to stderr:

```json
{
  "error": true,
  "code": "API_ERROR",
  "message": "Request failed with status 500",
  "hints": [{ "message": "Check your network connection" }]
}
```

### Interactive commands

Commands with interactive prompts (`select`, `confirm`, `text`) should validate required flags in a `preAction` hook. This fires before `runCommand` (no wasted auth/API calls) and works for both `--json` and piped/CI sessions:

```typescript
export function getMyCommand(context: CLIContext): Command {
  return new Command("my-cmd")
    .option("-y, --yes", "Skip confirmation prompt")
    .hook("preAction", (command) => {
      if (!context.isJsonMode && !context.isNonInteractive) return;
      if (!command.opts().yes) {
        command.error("Non-interactive mode requires: --yes");
      }
    })
    .action(async (options) => {
      await runCommand(() => myAction(options), { requireAuth: true }, context);
    });
}
```

List specific missing flags so users know exactly what to add (e.g., `Missing: --project-id <id>, --path <path>`).

## Rules (Command-Specific)

- **Command factory pattern** - Commands export `getXCommand(context)` functions, not static instances
- **Command wrapper** - All commands use `runCommand(fn, options, context)` utility
- **Task wrapper** - Use `runTask()` for async operations with spinners
- **Use theme for styling** - Never use `chalk` directly; import `theme` from `@/cli/utils/` and use semantic names
- **Use fs.ts utilities** - Always use `@/core/utils/fs.js` for file operations
- **Consistent copy across related commands** - User-facing messages (errors, success, hints) for commands in the same group should use consistent language and structure. When writing validation errors, outro messages, or spinner text, check sibling commands for parity so the product voice stays coherent.
