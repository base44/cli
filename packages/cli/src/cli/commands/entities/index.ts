import { Command } from "commander";
import { getEntitiesCountCommand } from "./count.js";
import { getEntitiesGetCommand } from "./get.js";
import { getEntitiesListCommand } from "./list.js";
import { getEntitiesPushCommand } from "./push.js";

export function getEntitiesCommand(): Command {
  return new Command("entities")
    .description("Manage project entities")
    .addCommand(getEntitiesPushCommand())
    .addCommand(getEntitiesListCommand())
    .addCommand(getEntitiesGetCommand())
    .addCommand(getEntitiesCountCommand());
}
