import { Command } from "commander";
import { getAutomationsStatusCommand } from "./status.js";

export function getAutomationsCommand(): Command {
  return new Command("automations")
    .description("Manage automations")
    .addCommand(getAutomationsStatusCommand());
}
