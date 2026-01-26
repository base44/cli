import { Command } from "commander";
import { readAuth } from "@/core/auth/index.js";
import { runCommand, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

async function whoami(): Promise<RunCommandResult> {
  const auth = await readAuth();
  return { outroMessage: `Logged in as: ${theme.styles.bold(auth.email)}` };
}

export const whoamiCommand = new Command("whoami")
  .description("Display current authenticated user")
  .action(async () => {
    await runCommand(whoami, { requireAuth: true, requireAppConfig: false });
  });
