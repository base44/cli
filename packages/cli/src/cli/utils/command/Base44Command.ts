import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import {
  type RunCommandResult,
  showError,
  showIntro,
  showOutro,
} from "@/cli/utils/command/display.js";
import { ensureAppConfig, ensureAuth } from "@/cli/utils/command/middleware.js";
import { startUpgradeCheck } from "@/cli/utils/upgradeNotification.js";

export type { RunCommandResult } from "@/cli/utils/command/display.js";

interface Base44CommandOptions {
  /**
   * Require user authentication before running this command.
   * If the user is not logged in, they will be prompted to login.
   * @default true
   */
  requireAuth?: boolean;
  /**
   * Initialize app config before running this command.
   * Reads .app.jsonc and caches the appId for sync access via getAppConfig().
   * @default true
   */
  requireAppConfig?: boolean;
  /**
   * Use the full ASCII art banner instead of the simple intro tag.
   * Useful for commands like `create` that want more visual impact.
   * @default false
   */
  fullBanner?: boolean;
}

/**
 * A Command subclass that automatically wraps the action with the Base44
 * lifecycle: intro/banner, auth check, app config, outro, and error handling.
 *
 * Command authors use this instead of `new Command()` and never need to
 * manage the lifecycle manually. It runs transparently inside `.action()`.
 *
 * Context is injected automatically via a program-level `preAction` hook
 * in `createProgram()`. Command files do not need to handle context at all.
 *
 * When `isNonInteractive` is true (CI / piped output), all clack UI
 * (intro, outro, themed errors) is skipped. Errors go to stderr as plain text.
 * Action functions that need this value can access it via `command.isNonInteractive`
 * (Commander passes the command instance as the last argument to action handlers).
 *
 * **Important**: Commands should NOT call `intro()` or `outro()` directly.
 * Commands can return an optional `outroMessage` and `stdout` via `RunCommandResult`.
 *
 * @param name - The command name (e.g. "deploy", "login")
 * @param options - Optional configuration to override defaults
 *
 * @example
 * // Standard command (auth required, loads app config)
 * new Base44Command("deploy")
 *
 * @example
 * // Skip auth and app config (e.g. login command)
 * new Base44Command("login", { requireAuth: false, requireAppConfig: false })
 *
 * @example
 * // Full usage in a command file
 * export function getMyCommand(): Command {
 *   return new Base44Command("my-command")
 *     .description("Does something")
 *     .option("-f, --flag", "Some flag")
 *     .action(async (options) => {
 *       // ... business logic ...
 *       return { outroMessage: "Done!" };
 *     });
 * }
 */
export class Base44Command extends Command {
  private _context?: CLIContext;
  private _commandOptions: Required<Base44CommandOptions>;

  constructor(name: string, options?: Base44CommandOptions) {
    super(name);
    this._commandOptions = {
      requireAuth: options?.requireAuth ?? true,
      requireAppConfig: options?.requireAppConfig ?? true,
      fullBanner: options?.fullBanner ?? false,
    };
  }

  /**
   * Inject the CLI context. Called by the program-level `preAction` hook
   * in `createProgram()` before any command action executes.
   */
  setContext(context: CLIContext): void {
    this._context = context;
  }

  /**
   * Whether the CLI is running in non-interactive mode (CI, piped output).
   * Available for action functions that need to adjust behavior
   * (e.g. skip browser opens, skip confirmation prompts).
   */
  /** @public */
  get isNonInteractive(): boolean {
    return this._context?.isNonInteractive ?? false;
  }

  private get context(): CLIContext {
    if (!this._context) {
      throw new Error(
        "Base44Command context not set. Ensure the command is registered via createProgram().",
      );
    }
    return this._context;
  }

  /** @public - called by Commander internally via command dispatch */
  // biome-ignore lint/suspicious/noExplicitAny: must match Commander.js action() signature
  override action(
    fn: (...args: any[]) => void | Promise<void | RunCommandResult>,
  ): this {
    // biome-ignore lint/suspicious/noExplicitAny: must match Commander.js action() signature
    return super.action(async (...args: any[]) => {
      const quiet = this.context.isNonInteractive;

      if (!quiet) {
        await showIntro(
          this._commandOptions.fullBanner,
          this.context.isNonInteractive,
        );
      }

      const upgradeCheckPromise = startUpgradeCheck();

      try {
        if (this._commandOptions.requireAuth) {
          await ensureAuth(this.context.errorReporter);
        }
        if (this._commandOptions.requireAppConfig) {
          await ensureAppConfig(this.context.errorReporter);
        }

        const result = ((await fn(...args)) ?? {}) as RunCommandResult;

        if (!quiet) {
          await showOutro(
            result,
            upgradeCheckPromise,
            this.context.distribution,
          );
        } else if (result.stdout) {
          process.stdout.write(result.stdout);
        }
      } catch (error) {
        showError(error, this.context, quiet);
        throw error;
      }
    });
  }
}
