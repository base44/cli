import { Command } from "commander";
import { getVersionCreateCommand } from "./create.js";
import { getVersionDeployCommand } from "./deploy.js";

export function getVersionsCommand(): Command {
  return new Command("versions")
    .description("Record app versions and serve them")
    .addCommand(getVersionCreateCommand())
    .addCommand(getVersionDeployCommand());
}
