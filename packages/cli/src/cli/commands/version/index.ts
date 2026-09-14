import { Command } from "commander";
import { getVersionCreateCommand } from "./create.js";
import { getVersionDeployCommand } from "./deploy.js";

export function getVersionCommand(): Command {
  return new Command("version")
    .description("Record app versions and serve them")
    .addCommand(getVersionCreateCommand())
    .addCommand(getVersionDeployCommand());
}
