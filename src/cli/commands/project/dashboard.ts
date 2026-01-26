import { Command } from "commander";
import open from "open";
import { runCommand, getDashboardUrl } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

async function openDashboard(): Promise<RunCommandResult> {
  const dashboardUrl = getDashboardUrl();

  await open(dashboardUrl);

  return { outroMessage: `Dashboard opened at ${dashboardUrl}` };
}

export const dashboardCommand = new Command("dashboard")
  .description("Open the app dashboard in your browser")
  .action(async () => {
    await runCommand(openDashboard, { requireAuth: true });
  });
