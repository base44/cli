import type { Command } from "commander";
import open from "open";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, getDashboardUrl } from "@/cli/utils/index.js";

async function openDashboard({
  isNonInteractive,
}: CLIContext): Promise<RunCommandResult> {
  const dashboardUrl = getDashboardUrl();

  if (!isNonInteractive) {
    await open(dashboardUrl);
  }

  return { outroMessage: `Dashboard opened at ${dashboardUrl}` };
}

export function getDashboardOpenCommand(): Command {
  return new Base44Command("open")
    .description("Open the app dashboard in your browser")
    .action(openDashboard);
}
