import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { Base44LocalProjectSDK } from "@/core/index.js";
import { runCommand, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

async function whoami(): Promise<RunCommandResult> {
  const auth = await Base44LocalProjectSDK.auth.getAuthData();
  return { outroMessage: `Logged in as: ${theme.styles.bold(auth.email)}` };
}

export function getWhoamiCommand(context: CLIContext): Command {
  return new Command("whoami")
    .description("Display current authenticated user")
    .action(async () => {
      await runCommand(whoami, { requireAuth: true, requireAppConfig: false }, context);
    });
}
