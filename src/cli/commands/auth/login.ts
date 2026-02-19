import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import { login, loginWithApiKey } from "./login-flow.js";

export function getLoginCommand(context: CLIContext): Command {
  return new Command("login")
    .description("Authenticate with Base44")
    .option(
      "--api-key <key>",
      "Authenticate using an API key (for CI/CD environments)",
    )
    .action(async (options: { apiKey?: string }) => {
      if (options.apiKey) {
        await runCommand(
          () => loginWithApiKey(options.apiKey as string),
          { requireAppConfig: false },
          context,
        );
      } else {
        await runCommand(login, { requireAppConfig: false }, context);
      }
    });
}
