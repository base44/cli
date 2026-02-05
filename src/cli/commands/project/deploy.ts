import { confirm, isCancel, log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import type { Base44LocalProjectSDK } from "@/core/index.js";
import { runCommand, runTask, theme, getDashboardUrl } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

interface DeployOptions {
  yes?: boolean;
}

async function deployAction(sdk: Base44LocalProjectSDK, options: DeployOptions): Promise<RunCommandResult> {
  if (!await sdk.hasResourcesToDeploy()) {
    return {
      outroMessage: "No resources found to deploy",
    };
  }

  const projectData = await sdk.project.readConfig();
  const { project, entities, functions, agents } = projectData;

  // Build summary of what will be deployed
  const summaryLines: string[] = [];
  if (entities.length > 0) {
    summaryLines.push(
      `  - ${entities.length} ${entities.length === 1 ? "entity" : "entities"}`
    );
  }
  if (functions.length > 0) {
    summaryLines.push(
      `  - ${functions.length} ${functions.length === 1 ? "function" : "functions"}`
    );
  }
  if (agents.length > 0) {
    summaryLines.push(
      `  - ${agents.length} ${agents.length === 1 ? "agent" : "agents"}`
    );
  }
  if (project.site?.outputDirectory) {
    summaryLines.push(`  - Site from ${project.site.outputDirectory}`);
  }

  // Confirmation prompt
  if (!options.yes) {
    log.warn(
      `This will update your Base44 app with:\n${summaryLines.join("\n")}`
    );

    const shouldDeploy = await confirm({
      message: "Are you sure you want to continue?",
    });

    if (isCancel(shouldDeploy) || !shouldDeploy) {
      return { outroMessage: "Deployment cancelled" };
    }
  } else {
    log.info(`Deploying:\n${summaryLines.join("\n")}`);
  }

  const result = await runTask(
    "Deploying your app...",
    async () => {
      return await sdk.deployAll();
    },
    {
      successMessage: theme.colors.base44Orange("Deployment completed"),
      errorMessage: "Deployment failed",
    }
  );

  log.message(`${theme.styles.header("Dashboard")}: ${theme.colors.links(getDashboardUrl(sdk.config.appId))}`);

  if (result.appUrl) {
    log.message(
      `${theme.styles.header("App URL")}: ${theme.colors.links(result.appUrl)}`
    );
  }

  return { outroMessage: "App deployed successfully" };
}

export function getDeployCommand(context: CLIContext): Command {
  return new Command("deploy")
    .description(
      "Deploy all project resources (entities, functions, agents, and site)"
    )
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (options: DeployOptions) => {
      await runCommand((sdk) => deployAction(sdk, options), { requireAuth: true }, context);
    });
}
