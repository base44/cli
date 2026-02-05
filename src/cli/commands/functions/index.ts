import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { getFunctionsDeployCommand } from "./deploy.js";

export function getFunctionsCommand(context: CLIContext): Command {
  return new Command("functions")
    .description("Manage project functions")
    .addCommand(getFunctionsDeployCommand(context));
}
