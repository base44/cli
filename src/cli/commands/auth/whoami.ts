import { Command } from "commander";
import { log } from "@clack/prompts";
import { readAuth } from "@config/auth.js";
import { runCommand } from "../../utils/index.js";

async function whoami(): Promise<void> {
  const auth = await readAuth();
  log.info(`Logged in as: ${auth.name} (${auth.email})`);
}

export const whoamiCommand = new Command("whoami")
  .description("Display current authenticated user")
  .action(async () => {
    await runCommand(whoami);
  });
