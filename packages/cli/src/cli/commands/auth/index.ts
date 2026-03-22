import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { getPasswordLoginCommand } from "./password-login.js";
import { getAuthPullCommand } from "./pull.js";
import { getAuthPushCommand } from "./push.js";

export function getAuthCommand(context: CLIContext): Command {
  return new Command("auth")
    .description("Manage app authentication settings")
    .addCommand(getPasswordLoginCommand(context))
    .addCommand(getAuthPullCommand(context))
    .addCommand(getAuthPushCommand(context));
}
