import { Command } from "commander";
import { log } from "@clack/prompts";
import { execa } from "execa";
import { getBase44ApiUrl, getBase44ClientId, loadProjectEnv } from "@core/config.js";
import { runCommand, theme } from "../../utils/index.js";
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

  const dashboardUrl = `${getBase44ApiUrl()}/apps/${projectId}/editor/preview`;

  log.info(theme.colors.base44Orange("Opening dashboard..."));

  // Determine the command to open the browser based on platform
  const platform = process.platform;
  let openCommand: string;

  if (platform === "darwin") {
    openCommand = "open";
  } else if (platform === "win32") {
    openCommand = "start";
  } else {
    // Linux and other Unix-like systems
    openCommand = "xdg-open";
  }

  try {
    await execa(openCommand, [dashboardUrl], { shell: true });
  } catch (error) {
    // If the command fails, just log the URL for the user to open manually
    log.warn("Could not open browser automatically");
    log.message(`${theme.styles.header("Dashboard")}: ${theme.colors.links(dashboardUrl)}`);
    return {};
  }

  return { outroMessage: `Dashboard opened at ${dashboardUrl}` };
}

export const dashboardCommand = new Command("dashboard")
  .description("Open the app dashboard in your browser")
  .action(async () => {
    await runCommand(openDashboard);
  });
