import { Command } from "commander";
import open from "open";
import type { CLIContext } from "@/cli/types.js";
import { getDashboardUrl, runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import type { ProjectSDK } from "@/core/sdk.js";

async function openDashboard(sdk: ProjectSDK): Promise<RunCommandResult> {
  const appId = sdk.project.getAppConfig().id;
  const dashboardUrl = getDashboardUrl(appId);

  if (!process.env.CI) {
    await open(dashboardUrl);
  }

  return { outroMessage: `Dashboard opened at ${dashboardUrl}` };
}

export function getDashboardOpenCommand(context: CLIContext): Command {
  return new Command("open")
    .description("Open the app dashboard in your browser")
    .action(async () => {
      await runCommand(openDashboard, { requireAuth: true }, context);
    });
}
