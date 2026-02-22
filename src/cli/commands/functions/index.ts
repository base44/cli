import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { getDeleteCommand } from "./delete.js";
import { getDeployCommand } from "./deploy.js";
import { getListCommand } from "./list.js";

export function getFunctionsCommand(context: CLIContext): Command {
  return new Command("functions")
    .description("Manage backend functions")
    .addCommand(getDeployCommand(context))
    .addCommand(getListCommand(context))
    .addCommand(getDeleteCommand(context));
}
