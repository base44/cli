import { Command } from "commander";
import { deleteAuth } from "@core/auth/index.js";
import { runCommand } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

/**
 * Logout command does not support --json output.
 * It is a user-facing auth command that is rarely scripted.
 */
async function logout(): Promise<RunCommandResult<never>> {
  await deleteAuth();
  return { outroMessage: "Logged out successfully" };
}

export const logoutCommand = new Command("logout")
  .description("Logout from current device")
  .action(async () => {
    await runCommand(logout, { requireAppConfig: false });
  });

