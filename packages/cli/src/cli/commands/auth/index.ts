import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { getPasswordLoginCommand } from "./password-login.js";

export function getAuthCommand(context: CLIContext): Command {
  return new Command("auth")
    .description("Manage app authentication settings")
    .addCommand(getPasswordLoginCommand(context));
}
