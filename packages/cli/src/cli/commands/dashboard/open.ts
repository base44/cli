import { Command } from "commander";
import open from "open";
import type { CLIContext } from "@/cli/types.js";
import { getDashboardUrl, runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

async function openDashboard(
  isNonInteractive: boolean,
): Promise<RunCommandResult> {
  const dashboardUrl = getDashboardUrl();

  if (!isNonInteractive) {
    await open(dashboardUrl);
  }

  return { outroMessage: `Dashboard opened at ${dashboardUrl}` };
}

export function getDashboardOpenCommand(context: CLIContext): Command {
  return new Command("open")
    .description("Open the app dashboard in your browser")
    .action(async () => {
      await runCommand(
        () => openDashboard(context.isNonInteractive),
        { requireAuth: true },
        context,
      );
    });
}
