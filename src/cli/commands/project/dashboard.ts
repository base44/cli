import { Command } from "commander";
import open from "open";
import { runCommand, getDashboardUrl, isJsonMode } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

interface DashboardOptions {
  open?: boolean;
}

/**
 * JSON output result for the dashboard command.
 */
interface DashboardResult {
  /** The URL to the project dashboard. */
  dashboardUrl: string;
}

async function openDashboard(options: DashboardOptions): Promise<RunCommandResult<DashboardResult>> {
  const dashboardUrl = getDashboardUrl();

  // Skip opening browser in JSON mode or with --no-open flag
  const shouldOpen = !isJsonMode() && options.open !== false;

  if (shouldOpen) {
    await open(dashboardUrl);
  }

  return {
    outroMessage: shouldOpen
      ? `Dashboard opened at ${dashboardUrl}`
      : `Dashboard URL: ${dashboardUrl}`,
    data: {
      dashboardUrl,
    },
  };
}

export const dashboardCommand = new Command("dashboard")
  .description("Open the app dashboard in your browser")
  .option("--no-open", "Print the URL without opening the browser")
  .action(async (options: DashboardOptions) => {
    await runCommand(() => openDashboard(options), { requireAuth: true });
  });
