import { Command } from "commander";
import { performLogin } from "@core/auth/login.js";
import { runCommand } from "../../utils/index.js";

async function login(): Promise<void> {
  await performLogin();
}

export const loginCommand = new Command("login")
  .description("Authenticate with Base44")
  .action(async () => {
    await runCommand(login);
  });
