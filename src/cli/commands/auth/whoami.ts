import { Command } from "commander";
import { log } from "@clack/prompts";
import { readAuth } from "../../../core/config/auth.js";
import { runCommand } from "../../utils/index.js";

async function whoami(): Promise<void> {
  try {
    const auth = await readAuth();
    log.info(`Logged in as: ${auth.name} (${auth.email})`);
  } catch (error) {
    if (error instanceof Error) {
      log.error(error.message);
    } else {
      log.error("Failed to read authentication data");
    }
  }
}

export const whoamiCommand = new Command("whoami")
  .description("Display current authenticated user")
  .action(async () => {
    await runCommand(whoami);
  });

