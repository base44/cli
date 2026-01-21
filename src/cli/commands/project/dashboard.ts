import { Command } from "commander";
import open from "open";
import { getBase44ApiUrl, getBase44ClientId, loadProjectEnv } from "@core/config.js";
import { runCommand } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

async function openDashboard(): Promise<RunCommandResult> {
  // Load project environment to get the project ID
  await loadProjectEnv();

  const projectId = getBase44ClientId();

  if (!projectId) {
    throw new Error(
      "App not configured. BASE44_CLIENT_ID environment variable is required. Set it in your .env.local file."
    );
  }

  const dashboardUrl = `${getBase44ApiUrl()}/apps/${projectId}/editor/workspace/overview`;

  await open(dashboardUrl);

  return { outroMessage: `Dashboard opened at ${dashboardUrl}` };
}

export const dashboardCommand = new Command("dashboard")
  .description("Open the app dashboard in your browser")
  .action(async () => {
    await runCommand(openDashboard, { requireAuth: true });
  });
