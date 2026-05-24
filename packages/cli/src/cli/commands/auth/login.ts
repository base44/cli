import type { Command } from "commander";
import { Base44Command } from "@/cli/utils/index.js";
import { login } from "./login-flow.js";

export function getLoginCommand(): Command {
  return new Base44Command("login", {
    requireAuth: false,
    requireAppConfig: false,
  })
    .description("Authenticate with Base44")
    .option(
      "--device-code",
      "Use device code flow instead of opening a browser",
      false,
    )
    .action(login);
}
