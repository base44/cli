import { intro, log } from "@clack/prompts";
import chalk from "chalk";
import { loadProjectEnv } from "@core/config.js";

const base44Color = chalk.bgHex("#E86B3C");

/**
 * Wraps a command function with the Base44 intro banner.
 * All CLI commands should use this utility to ensure consistent branding.
 * Also loads .env.local from the project root if available.
 *
 * @param commandFn - The async function to execute as the command
 */
export async function runCommand(
  commandFn: () => Promise<void>
): Promise<void> {
  intro(base44Color(" Base 44 "));

  // Load .env.local from project root (if in a project)
  await loadProjectEnv();

  try {
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
