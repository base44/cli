import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { getRecordsCreateCommand } from "./create.js";
import { getRecordsDeleteCommand } from "./delete.js";
import { getRecordsGetCommand } from "./get.js";
import { getRecordsListCommand } from "./list.js";
import { getRecordsUpdateCommand } from "./update.js";

export function getRecordsCommand(context: CLIContext): Command {
  return new Command("records")
    .description("CRUD operations on entity records")
    .addCommand(getRecordsListCommand(context))
    .addCommand(getRecordsGetCommand(context))
    .addCommand(getRecordsCreateCommand(context))
    .addCommand(getRecordsUpdateCommand(context))
    .addCommand(getRecordsDeleteCommand(context));
}
