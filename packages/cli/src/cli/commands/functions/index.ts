import { Command } from "commander";
import { getDeleteCommand } from "./delete.js";
import { getDeployCommand } from "./deploy.js";
import { getListCommand } from "./list.js";
import { getPullCommand } from "./pull.js";

export function getFunctionsCommand(): Command {
  return new Command("functions")
    .description("Manage backend functions")
    .addCommand(getDeployCommand())
    .addCommand(getDeleteCommand())
    .addCommand(getListCommand())
    .addCommand(getPullCommand());
}
