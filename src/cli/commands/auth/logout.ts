import { Command } from "commander";
import { log } from "@clack/prompts";
import { deleteAuth } from "@config/auth.js";
import { runCommand } from "../../utils/index.js";

async function logout(): Promise<void> {
  await deleteAuth();
  log.info("Logged out successfully");
}

export const logoutCommand = new Command("logout")
  .description("Logout from current device")
  .action(async () => {
    await runCommand(logout);
  });

