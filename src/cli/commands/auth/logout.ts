import { Command } from "commander";
import { log } from "@clack/prompts";
import { deleteAuth } from "../../../core/config/auth.js";
import { runCommand } from "../../utils/index.js";

async function logout(): Promise<void> {
  try {
    await deleteAuth();
    log.info("Logged out successfully");
  } catch (error) {
    if (error instanceof Error) {
      log.error(error.message);
    } else {
      log.error("Failed to logout");
    }
  }
}

export const logoutCommand = new Command("logout")
  .description("Logout from current device")
  .action(async () => {
    await runCommand(logout);
  });

