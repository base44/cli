import { Command } from "commander";
import { log } from "@clack/prompts";
import type { CLIContext } from "@/cli/types.js";
import { getDashboardUrl, runCommand, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { readAuth } from "@/core/auth/index.js";
import { getAppConfig } from "@/core/project/index.js";

async function status(): Promise<RunCommandResult> {
  const appConfig = getAppConfig();
  const auth = await readAuth();

  log.info(`${theme.styles.header("App ID")}:     ${appConfig.id}`);
  log.info(`${theme.styles.header("Project")}:    ${appConfig.projectRoot}`);
  log.info(`${theme.styles.header("User")}:       ${theme.styles.bold(auth.email)}`);
  log.info(
    `${theme.styles.header("Dashboard")}:  ${theme.colors.links(getDashboardUrl(appConfig.id))}`,
  );

  return {};
}

export function getStatusCommand(context: CLIContext): Command {
  return new Command("status")
    .description("Show current project and authentication status")
    .action(async () => {
      await runCommand(status, { requireAuth: true }, context);
    });
}
