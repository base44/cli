import { intro, log, outro } from "@clack/prompts";
import chalk from "chalk";
import { loadProjectEnv } from "@core/config.js";
import { isLoggedIn } from "@core/auth/index.js";
import { printBanner } from "./banner.js";
import { login } from "../commands/auth/login.js";

const base44Color = chalk.bgHex("#E86B3C");

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
}

export interface RunCommandResult {
  outroMessage?: string;
};

/**
 * Wraps a command function with the Base44 intro/outro and error handling.
 * All CLI commands should use this utility to ensure consistent branding.
 *
 * **Responsibilities**:
 * - Displays the intro (simple tag or full ASCII banner)
 * - Loads `.env.local` from the project root if available
 * - Checks authentication if `requireAuth` is set
 * - Runs the command function
 * - Displays the outro message returned by the command
 * - Handles errors and exits with code 1 on failure
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
export async function runCommand(
  commandFn: () => Promise<RunCommandResult>,
  options?: RunCommandOptions
): Promise<void> {
  if (options?.fullBanner) {
    await printBanner();
    intro("");
  } else {
    intro(base44Color(" Base 44 "));
  }

  await loadProjectEnv();

  try {
    // Check authentication if required
    if (options?.requireAuth) {
      const loggedIn = await isLoggedIn();

      if (!loggedIn) {
        log.info("You need to login first to continue.");
        await login();
      }
    }

    const { outroMessage } = await commandFn();
    outro(outroMessage || "");
  } catch (e) {
    if (e instanceof Error) {
      log.error(e.stack ?? e.message);
    } else {
      log.error(String(e));
    }
    process.exit(1);
  }
}
