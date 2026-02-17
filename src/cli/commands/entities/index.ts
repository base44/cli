import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { getEntitiesPushCommand } from "./push.js";
import { getRecordsCommand } from "./records/index.js";

export function getEntitiesCommand(context: CLIContext): Command {
  return new Command("entities")
    .description("Manage project entities")
    .addCommand(getEntitiesPushCommand(context))
    .addCommand(getRecordsCommand(context));
}
