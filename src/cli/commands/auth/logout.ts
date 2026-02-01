import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { Base44LocalProjectSDK } from "@/core/index.js";
import { runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

async function logout(): Promise<RunCommandResult> {
  await Base44LocalProjectSDK.auth.logout();
  return { outroMessage: "Logged out successfully" };
}

export function getLogoutCommand(context: CLIContext): Command {
  return new Command("logout")
    .description("Logout from current device")
    .action(async () => {
      await runCommand(logout, { requireAppConfig: false }, context);
    });
}
