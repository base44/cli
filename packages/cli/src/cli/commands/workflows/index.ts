import { Command } from "commander";
import { getWorkflowsListCommand } from "./list.js";
import { getWorkflowsRunsCommand } from "./runs.js";

export function getWorkflowsCommand(): Command {
  return new Command("workflows")
    .description("Inspect this app's workflows and their runs")
    .addCommand(getWorkflowsListCommand())
    .addCommand(getWorkflowsRunsCommand());
}
