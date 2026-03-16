import type { Command } from "commander";
import open from "open";
import type { RunCommandResult } from "@/cli/types.js";
import { Base44Command, getDashboardUrl } from "@/cli/utils/index.js";

async function openDashboard(
  isNonInteractive: boolean,
): Promise<RunCommandResult> {
  const dashboardUrl = getDashboardUrl();

  if (!isNonInteractive) {
    await open(dashboardUrl);
  }

  return { outroMessage: `Dashboard opened at ${dashboardUrl}` };
}

export function getDashboardOpenCommand(): Command {
  return new Base44Command("open")
    .description("Open the app dashboard in your browser")
    .action(async (_options: unknown, command: Base44Command) => {
      return await openDashboard(command.isNonInteractive);
    });
}
