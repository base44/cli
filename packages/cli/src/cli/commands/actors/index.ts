import { Command } from "commander";
import { getDeleteCommand } from "./delete.js";
import { getDeployCommand } from "./deploy.js";

export function getActorsCommand(): Command {
  return new Command("actors")
    .description("Manage actors")
    .addCommand(getDeployCommand())
    .addCommand(getDeleteCommand());
}
