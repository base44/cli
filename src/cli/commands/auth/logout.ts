import { Command } from "commander";
import { deleteAuth } from "@core/auth/index.js";
import { runCommand } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

async function logout(): Promise<RunCommandResult> {
  await deleteAuth();
  return { outroMessage: "Logged out successfully" };
}

export const logoutCommand = new Command("logout")
  .description("Logout from current device")
  .action(async () => {
    await runCommand(logout);
  });

