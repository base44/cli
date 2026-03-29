import { Command } from "commander";
import { getPasswordLoginCommand } from "./password-login.js";
import { getAuthPullCommand } from "./pull.js";
import { getAuthPushCommand } from "./push.js";

export function getAuthCommand(): Command {
  return new Command("auth")
    .description("Manage app authentication settings")
    .addCommand(getPasswordLoginCommand())
    .addCommand(getAuthPullCommand())
    .addCommand(getAuthPushCommand());
}
