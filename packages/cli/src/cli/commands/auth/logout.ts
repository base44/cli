import type { Command } from "commander";
import { Base44Command, type RunCommandResult } from "@/cli/utils/index.js";
import { deleteAuth } from "@/core/auth/index.js";

async function logout(): Promise<RunCommandResult> {
  await deleteAuth();
  return { outroMessage: "Logged out successfully" };
}

export function getLogoutCommand(): Command {
  return new Base44Command("logout", { requireAppConfig: false })
    .description("Logout from current device")
    .action(logout);
}
