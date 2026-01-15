import { intro, log } from "@clack/prompts";
import chalk from "chalk";
import { loadProjectEnv } from "@core/config.js";
import { requireAuth } from "@core/auth/index.js";
import { printBanner } from "./banner.js";

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

/**
 * Wraps a command function with the Base44 intro banner and error handling.
 * All CLI commands should use this utility to ensure consistent branding.
 * Also loads .env.local from the project root if available.
 *
 * @param commandFn - The async function to execute as the command
 * @param options - Optional configuration for the command wrapper
 *
 * @example
 * // Standard command with simple intro
 * export const myCommand = new Command("my-command")
 *   .action(async () => {
 *     await runCommand(myAction);
 *   });
 *
 * @example
 * // Command requiring authentication
 * export const myCommand = new Command("my-command")
 *   .action(async () => {
 *     await runCommand(myAction, { requireAuth: true });
 *   });
 */
export async function runCommand(
  commandFn: () => Promise<void>,
  options?: RunCommandOptions
): Promise<void> {
  if (options?.fullBanner) {
    printBanner();
  } else {
    intro(base44Color(" Base 44 "));
  }

  await loadProjectEnv();

  try {
    // Check authentication if required
    if (options?.requireAuth) {
      await requireAuth();
    }

    await commandFn();
  } catch (e) {
    if (e instanceof Error) {
      log.error(e.stack ?? e.message);
    } else {
      log.error(String(e));
    }
    process.exit(1);
  }
}
