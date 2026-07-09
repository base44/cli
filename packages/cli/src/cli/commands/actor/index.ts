import { Command } from "commander";
import { getDeployCommand } from "./deploy.js";
import { getNewCommand } from "./new.js";

export function getActorCommand(): Command {
  return new Command("actor")
    .description("Manage actors")
    .addCommand(getNewCommand())
    .addCommand(getDeployCommand());
}
