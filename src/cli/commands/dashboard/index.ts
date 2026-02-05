import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { getDashboardOpenCommand } from "./open.js";

export function getDashboardCommand(context: CLIContext): Command {
  return new Command("dashboard")
    .description("Manage app dashboard")
    .addCommand(getDashboardOpenCommand(context));
}
