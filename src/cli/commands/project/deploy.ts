import { Command } from "commander";
import { confirm, isCancel } from "@clack/prompts";
import {
  readProjectConfig,
  deployAll,
  hasResourcesToDeploy,
} from "@core/project/index.js";
import { runCommand, runTask, theme, getDashboardUrl, isJsonMode, log } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

interface DeployOptions {
  yes?: boolean;
}

/**
 * JSON output result for the deploy command.
 */
interface DeployResult {
  /** The URL to the project dashboard. */
  dashboardUrl: string;
  /** The public URL where the site is hosted (if site was deployed). */
  appUrl?: string;
  /** Number of entities deployed. */
  entitiesCount: number;
  /** Number of functions deployed. */
  functionsCount: number;
  /** Whether the site was deployed. */
  siteDeployed: boolean;
  /** True if the deployment was cancelled by the user. */
  cancelled?: boolean;
}

function validateNonInteractiveFlags(command: Command): void {
  const opts = command.optsWithGlobals<DeployOptions & { json?: boolean }>();
  if (opts.json && !opts.yes) {
    throw new Error("JSON mode requires: --yes (-y) to skip confirmation");
  }
}

async function deployAction(options: DeployOptions): Promise<RunCommandResult<DeployResult>> {
  const projectData = await readProjectConfig();

  if (!hasResourcesToDeploy(projectData)) {
    return {
      outroMessage: "No resources found to deploy",
      data: {
        dashboardUrl: getDashboardUrl(),
        entitiesCount: 0,
        functionsCount: 0,
        siteDeployed: false,
      },
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

  // Confirmation prompt (skipped in JSON mode due to validateNonInteractiveFlags)
  if (!options.yes) {
    log.warn(
      `This will update your Base44 app with:\n${summaryLines.join("\n")}`
    );

    const shouldDeploy = await confirm({
      message: "Are you sure you want to continue?",
    });

    if (isCancel(shouldDeploy) || !shouldDeploy) {
      return {
        outroMessage: "Deployment cancelled",
        data: {
          dashboardUrl: getDashboardUrl(),
          entitiesCount: entities.length,
          functionsCount: functions.length,
          siteDeployed: false,
          cancelled: true,
        },
      };
    }
  } else if (!isJsonMode()) {
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

  const dashboardUrl = getDashboardUrl();

  log.message(`${theme.styles.header("Dashboard")}: ${theme.colors.links(dashboardUrl)}`);
  if (result.appUrl) {
    log.message(`${theme.styles.header("App URL")}: ${theme.colors.links(result.appUrl)}`);
  }

  return {
    outroMessage: "App deployed successfully",
    data: {
      dashboardUrl,
      appUrl: result.appUrl,
      entitiesCount: entities.length,
      functionsCount: functions.length,
      siteDeployed: !!project.site?.outputDirectory,
    },
  };
}

export const deployCommand = new Command("deploy")
  .description("Deploy all project resources (entities, functions, and site)")
  .option("-y, --yes", "Skip confirmation prompt")
  .hook("preAction", validateNonInteractiveFlags)
  .action(async (options: DeployOptions) => {
    await runCommand(() => deployAction(options), { requireAuth: true });
  });
