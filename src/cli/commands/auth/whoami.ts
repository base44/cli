import chalk from "chalk";
import { Command } from "commander";
import { readAuth } from "@core/auth/index.js";
import { runCommand } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

async function whoami(): Promise<RunCommandResult> {
  const auth = await readAuth();
  return { outroMessage: `Logged in as: ${chalk.bold(auth.email)}` };
}

export const whoamiCommand = new Command("whoami")
  .description("Display current authenticated user")
  .action(async () => {
    await runCommand(whoami, { requireAuth: true });
  });
