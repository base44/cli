import { Command } from "commander";
import stripAnsi from "strip-ansi";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import {
  ensureAppContext,
  ensureAuth,
} from "@/cli/utils/command/middleware.js";
import {
  showCommandEnd,
  showCommandStart,
  showPlainError,
  showThemedError,
} from "@/cli/utils/command/render.js";
import {
  formatPlainUpgradeMessage,
  startUpgradeCheck,
} from "@/cli/utils/upgradeNotification.js";
import { ApiError, isCLIError } from "@/core/errors.js";

/**
 * Write a command result to stdout as a single JSON document (the `--json`
 * contract). Commands that build their own machine output set `result.stdout`
 * and we emit it verbatim; for everything else we wrap the human status line
 * in `{ output }` so `--json` always yields valid JSON. The status line of a
 * native command still goes to stderr so stdout stays a single JSON value.
 */
function writeJsonSuccess(result: RunCommandResult): void {
  if (result.stdout) {
    if (result.outroMessage) {
      process.stderr.write(`${result.outroMessage}\n`);
    }
    process.stdout.write(result.stdout);
    return;
  }
  process.stdout.write(
    `${JSON.stringify({ output: stripAnsi(result.outroMessage ?? "") })}\n`,
  );
}

/** Emit a failed command as a JSON error envelope on stdout (the `--json`
 * contract), carrying the structured CLIError fields when present. */
function writeJsonError(error: unknown): void {
  const envelope: Record<string, unknown> = {
    error: error instanceof Error ? error.message : String(error),
  };
  if (isCLIError(error)) {
    envelope.code = error.code;
    if (error.details.length > 0) {
      envelope.details = error.details;
    }
    if (error.hints.length > 0) {
      envelope.hints = error.hints;
    }
  }
  // An API failure's message reads the same whether the platform rejected the
  // key or fell over, so a caller diagnosing a run needs the status it got and
  // the request to look up server-side.
  if (error instanceof ApiError) {
    if (error.statusCode !== undefined) {
      envelope.statusCode = error.statusCode;
    }
    if (error.requestId !== undefined) {
      envelope.requestId = error.requestId;
    }
  }
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

interface Base44CommandOptions {
  /**
   * Require user authentication before running this command.
   * If the user is not logged in, they will be prompted to login.
   * @default true
   */
  requireAuth?: boolean;
  /**
   * Resolve the active app context before running this command.
   * The app ID may come from --app-id, BASE44_APP_ID, or .app.jsonc.
   * @default true
   */
  requireAppContext?: boolean;
  /**
   * Use the full ASCII art banner instead of the simple intro tag.
   * Useful for commands like `create` that want more visual impact.
   * @default false
   */
  fullBanner?: boolean;
}

export interface AppIdOptions {
  appId?: string;
}

/**
 * A Command subclass that automatically wraps the action with the Base44
 * lifecycle: intro/banner, auth check, app context, outro, and error handling.
 *
 * When `isNonInteractive` is true (CI / piped output), all clack UI
 * (intro, outro, themed errors) is skipped. Errors go to stderr as plain text.
 *
 * Action functions receive `CLIContext` as their first argument (injected by
 * this class), followed by Commander's normal positional args, options, and
 * command instance. Destructure what you need:
 *
 * @param name - The command name (e.g. "deploy", "login")
 * @param options - Optional configuration to override defaults
 *
 * @example
 * // Action function receives CLIContext first, then Commander args
 * async function myAction({ log }: CLIContext, options: MyOptions): Promise<RunCommandResult> {
 *   log.info("Doing something...");
 *   return { outroMessage: "Done!" };
 * }
 *
 * export function getMyCommand(): Command {
 *   return new Base44Command("my-command")
 *     .description("Does something")
 *     .option("-f, --flag", "Some flag")
 *     .action(myAction);
 * }
 */
export class Base44Command extends Command {
  private _context?: CLIContext;
  private _commandOptions: Required<Base44CommandOptions>;

  constructor(name: string, options?: Base44CommandOptions) {
    super(name);

    this._commandOptions = {
      requireAuth: options?.requireAuth ?? true,
      requireAppContext: options?.requireAppContext ?? true,
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

  private get context(): CLIContext {
    if (!this._context) {
      throw new Error(
        "Base44Command context not set. Ensure the command is registered via createProgram().",
      );
    }
    return this._context;
  }

  /**
   * Register an action that receives `CLIContext` as its first argument,
   * followed by Commander's positional args, options, and command instance.
   * Use the `CommandAction` type for action function signatures.
   * @public
   */
  // biome-ignore lint/suspicious/noExplicitAny: must match Commander.js action() signature
  override action(fn: (ctx: CLIContext, ...args: any[]) => any): this {
    // biome-ignore lint/suspicious/noExplicitAny: must match Commander.js action() signature
    return super.action(async (...args: any[]) => {
      // The global `--json` flag keeps stdout a pure JSON document: skip the
      // clack framing and send the status line to stderr.
      const jsonMode = this.context.jsonMode;
      const quiet = this.context.isNonInteractive || jsonMode;

      if (!quiet) {
        await showCommandStart(this._commandOptions.fullBanner);
      }

      const upgradeCheckPromise = startUpgradeCheck();

      try {
        if (this._commandOptions.requireAuth) {
          await ensureAuth(this.context);
        }
        if (this._commandOptions.requireAppContext) {
          const { appId } = this.optsWithGlobals<AppIdOptions>();
          await ensureAppContext(this.context, { appId });
        }

        const result = ((await fn(this.context, ...args)) ??
          {}) as RunCommandResult;

        if (!quiet) {
          await showCommandEnd(
            result,
            upgradeCheckPromise,
            this.context.distribution,
          );
        } else if (jsonMode) {
          writeJsonSuccess(result);
          const upgradeInfo = await upgradeCheckPromise;
          if (upgradeInfo) {
            process.stderr.write(
              `${formatPlainUpgradeMessage(upgradeInfo, this.context.distribution)}\n`,
            );
          }
        } else {
          if (result.outroMessage) {
            process.stdout.write(`${result.outroMessage}\n`);
          }
          if (result.stdout) {
            process.stdout.write(result.stdout);
          }
          const upgradeInfo = await upgradeCheckPromise;
          if (upgradeInfo) {
            process.stderr.write(
              `${formatPlainUpgradeMessage(upgradeInfo, this.context.distribution)}\n`,
            );
          }
        }
      } catch (error) {
        if (jsonMode) {
          // --json: emit the error as JSON on stdout (single machine channel).
          writeJsonError(error);
        } else if (quiet) {
          showPlainError(error);
        } else {
          showThemedError(error, this.context);
        }
        throw error;
      }
    });
  }
}
