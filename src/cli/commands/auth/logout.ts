import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import type { ProjectSDK } from "@/core/sdk.js";

async function logout(sdk: ProjectSDK): Promise<RunCommandResult> {
  await sdk.auth.delete();
  return { outroMessage: "Logged out successfully" };
}

export function getLogoutCommand(context: CLIContext): Command {
  return new Command("logout")
    .description("Logout from current device")
    .action(async () => {
      await runCommand(logout, { requireAppConfig: false }, context);
    });
}
