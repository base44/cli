import { Command } from "commander";
import open from "open";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, getDashboardUrl } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

async function openDashboard(): Promise<RunCommandResult> {
  const dashboardUrl = getDashboardUrl();

  if (!process.env.CI) {
    await open(dashboardUrl);
  }

  return { outroMessage: `Dashboard opened at ${dashboardUrl}` };
}

export function getDashboardCommand(context: CLIContext): Command {
  return new Command("dashboard")
    .description("Open the app dashboard in your browser")
    .action(async () => {
      await runCommand(openDashboard, { requireAuth: true }, context);
    });
}
