import { Command } from "commander";
import { confirm, isCancel, log } from "@clack/prompts";
import {
  readProjectConfig,
  deployAll,
  hasResourcesToDeploy,
} from "@/core/project/index.js";
import { runCommand, runTask, theme, getDashboardUrl } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

interface DeployOptions {
  yes?: boolean;
}

async function deployAction(options: DeployOptions): Promise<RunCommandResult> {
  const projectData = await readProjectConfig();

  if (!hasResourcesToDeploy(projectData)) {
    return {
      outroMessage: "No resources found to deploy",
    };
  }

  const { project, entities, functions } = projectData;

  // Build summary of what will be deployed
  const summaryLines: string[] = [];
  if (entities.length > 0) {
    summaryLines.push(`  - ${entities.length} ${entities.length === 1 ? "entity" : "entities"}`);
  }
  if (functions.length > 0) {
    summaryLines.push(`  - ${functions.length} ${functions.length === 1 ? "function" : "functions"}`);
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
      return await deployAll(projectData);
    },
    {
      successMessage: theme.colors.base44Orange("Deployment completed"),
      errorMessage: "Deployment failed",
    }
  );

  log.message(`${theme.styles.header("Dashboard")}: ${theme.colors.links(getDashboardUrl())}`);
  if (result.appUrl) {
    log.message(`${theme.styles.header("App URL")}: ${theme.colors.links(result.appUrl)}`);
  }

  return { outroMessage: "App deployed successfully" };
}

export const deployCommand = new Command("deploy")
  .description("Deploy all project resources (entities, functions, and site)")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (options: DeployOptions) => {
    await runCommand(() => deployAction(options), { requireAuth: true });
  });
