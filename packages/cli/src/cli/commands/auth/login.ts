import type { Command } from "commander";
import { Base44Command } from "@/cli/utils/index.js";
import { login } from "./login-flow.js";

export function getLoginCommand(): Command {
  return new Base44Command("login", {
    requireAuth: false,
    requireAppContext: false,
  })
    .description("Authenticate with Base44")
    .action(login);
}
