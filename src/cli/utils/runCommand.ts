import { intro, log } from "@clack/prompts";
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
  /**
   * Automatically trigger the login flow if the user is not authenticated.
   * This provides a smoother experience for commands like `create`.
   * Only applies when requireAuth is also true.
   * @default false
   */
  autoLogin?: boolean;
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
 * // Command requiring authentication with auto-login
 * export const myCommand = new Command("my-command")
 *   .action(async () => {
 *     await runCommand(myAction, { requireAuth: true, autoLogin: true });
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
      const loggedIn = await isLoggedIn();
      if (!loggedIn) {
        if (options.autoLogin) {
          log.info("You need to login first to continue.");
          await login();
        } else {
          throw new Error("Not logged in. Please run 'base44 login' first.");
        }
      }
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
