import { Command } from "commander";
import { getDashboardOpenCommand } from "./open.js";

export function getDashboardCommand(): Command {
  return new Command("dashboard")
    .description("Manage app dashboard")
    .addCommand(getDashboardOpenCommand());
}
