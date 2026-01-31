import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import { login } from "./login-flow.js";

export function getLoginCommand(context: CLIContext): Command {
  return new Command("login")
    .description("Authenticate with Base44")
    .action(async () => {
      await runCommand(login, { requireAppConfig: false }, context);
    });
}
