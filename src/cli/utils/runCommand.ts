import { intro, log } from "@clack/prompts";
import chalk from "chalk";
import { AuthApiError, AuthValidationError } from "@core/errors/index.js";

const base44Color = chalk.bgHex("#E86B3C");

/**
 * Wraps a command function with the Base44 intro banner.
 * All CLI commands should use this utility to ensure consistent branding.
 *
 * @param commandFn - The async function to execute as the command
 */
export async function runCommand(
  commandFn: () => Promise<void>
): Promise<void> {
  intro(base44Color(" Base 44 "));

  try {
    await commandFn();
  } catch (e) {
    if (e instanceof AuthValidationError) {
      const issues = e.issues.map((i) => i.message).join(", ");
      log.error(`Invalid response from server: ${issues}`);
    } else if (e instanceof AuthApiError || e instanceof Error) {
      log.error(e.message);
    } else {
      log.error(String(e));
    }
    process.exit(1);
  }
}
