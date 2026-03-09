import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { getSSORemoveCommand } from "./remove.js";
import { getSSOSetupCommand } from "./setup.js";

export function getSSOCommand(context: CLIContext): Command {
  return new Command("sso")
    .description("Manage SSO identity provider configuration")
    .addCommand(getSSOSetupCommand(context))
    .addCommand(getSSORemoveCommand(context));
}
