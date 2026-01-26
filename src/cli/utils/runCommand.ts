import { intro, log, outro } from "@clack/prompts";
import { isLoggedIn } from "@core/auth/index.js";
import { initAppConfig } from "@core/project/index.js";
import { CLIExitError } from "../errors.js";
import { printBanner } from "./banner.js";
import { login } from "../commands/auth/login.js";
import { theme } from "./theme.js";
import { isJsonMode, outputJson, outputJsonError } from "./json.js";

export interface RunCommandOptions {
  /**
   * Use the full ASCII art banner instead of the simple intro tag.
   * Useful for commands like `create` that want more visual impact.
   * @default false
   */
  fullBanner?: boolean;
  /**
   * Require user authentication before running this command.
   * If the user is not logged in, they will see an error message.
   * @default false
   */
  requireAuth?: boolean;
  /**
   * Initialize app config before running this command.
   * Reads .app.jsonc and caches the appId for sync access via getAppConfig().
   * @default true
   */
  requireAppConfig?: boolean;
}

/**
 * Result returned by command functions.
 *
 * @template TData - The shape of the JSON output data. Use `never` for commands
 *                   that don't support `--json` output (e.g., login, logout).
 */
export interface RunCommandResult<TData = Record<string, unknown>> {
  /**
   * Human-friendly message displayed in the outro (non-JSON mode only).
   */
  outroMessage?: string;
  /**
   * Structured data for JSON output. When `--json` flag is used,
   * this data is output as `{ success: true, data: ... }`.
   *
   * Commands that don't support `--json` should use `never` for TData.
   */
  data?: TData;
}

/**
 * Wraps a command function with the Base44 intro/outro and error handling.
 * All CLI commands should use this utility to ensure consistent branding.
 *
 * **Important**: Commands should NOT call `intro()` or `outro()` directly.
 * This function handles both. Commands can return an optional `outroMessage`
 * which will be displayed at the end.
 *
 * @param commandFn - The async function to execute. Returns `RunCommandResult` with optional `outroMessage`.
 * @param options - Optional configuration for the command wrapper
 *
 * @example
 * // Standard command with outro message
 * async function myAction(): Promise<RunCommandResult> {
 *   // ... do work ...
 *   return { outroMessage: "Done!" };
 * }
 *
 * export const myCommand = new Command("my-command")
 *   .action(async () => {
 *     await runCommand(myAction);
 *   });
 *
 * @example
 * // Command requiring authentication with full banner
 * export const myCommand = new Command("my-command")
 *   .action(async () => {
 *     await runCommand(myAction, { requireAuth: true, fullBanner: true });
 *   });
 */
export async function runCommand<TData = Record<string, unknown>>(
  commandFn: () => Promise<RunCommandResult<TData>>,
  options?: RunCommandOptions
): Promise<void> {
  const jsonMode = isJsonMode();

  // Skip visual elements in JSON mode
  if (!jsonMode) {
    console.log();

    if (options?.fullBanner) {
      await printBanner();
      intro("");
    } else {
      intro(theme.colors.base44OrangeBackground(" Base 44 "));
    }
  }

  try {
    // Check authentication if required
    if (options?.requireAuth) {
      const loggedIn = await isLoggedIn();

      if (!loggedIn) {
        if (jsonMode) {
          throw new Error("Authentication required. Please run 'base44 login' first.");
        }
        log.info("You need to login first to continue.");
        await login();
      }
    }

    // Initialize app config unless explicitly disabled
    if (options?.requireAppConfig !== false) {
      await initAppConfig();
    }

    const { outroMessage, data } = await commandFn();

    if (jsonMode) {
      // Output JSON response
      outputJson(data ?? {});
    } else {
      // Output human-friendly outro
      outro(outroMessage || "");
    }
  } catch (e) {
    if (jsonMode) {
      // Output JSON error
      outputJsonError(e instanceof Error ? e : String(e));
    } else if (e instanceof Error) {
        log.error(e.stack ?? e.message);
      } else {
        log.error(String(e));
      }
    throw new CLIExitError(1);
  }
}
