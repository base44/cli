# Adding & Modifying CLI Commands

**Keywords:** command, factory pattern, CLIContext, isNonInteractive, runCommand, runTask, spinner, theming, chalk, program.ts, register, banner, intro, outro

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
}
```

- Created once in `runCLI()` at startup
- `isNonInteractive` is `true` when stdin/stdout are not a TTY (e.g., CI, piped output, AI agents). Use it to skip interactive prompts, browser opens, and animations.
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

## Rules (Command-Specific)

- **Command factory pattern** - Commands export `getXCommand(context)` functions, not static instances
- **Command wrapper** - All commands use `runCommand(fn, options, context)` utility
- **Task wrapper** - Use `runTask()` for async operations with spinners
- **Use theme for styling** - Never use `chalk` directly; import `theme` from `@/cli/utils/` and use semantic names
- **Use fs.ts utilities** - Always use `@/core/utils/fs.js` for file operations
