import type { Logger } from "@base44-cli/logger";
import { confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import {
  filterPendingOAuth,
  promptOAuthFlows,
} from "@/cli/commands/connectors/oauth-prompt.js";
import { formatDeployResult } from "@/cli/commands/functions/formatDeployResult.js";
import { maybeBuildBeforeDeploy } from "@/cli/commands/project/site-build.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import {
  Base44Command,
  getConnectorsUrl,
  getDashboardUrl,
  theme,
} from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import {
  deployAll,
  hasResourcesToDeploy,
  readProjectConfig,
} from "@/core/project/index.js";
import type {
  ConnectorSyncResult,
  StripeSyncResult,
} from "@/core/resources/connector/index.js";

interface DeployOptions {
  yes?: boolean;
  build?: boolean;
  projectRoot?: string;
}

export async function deployAction(
  ctx: CLIContext,
  options: DeployOptions = {},
): Promise<RunCommandResult> {
  const { isNonInteractive, log } = ctx;
  if (isNonInteractive && !options.yes) {
    throw new InvalidInputError("--yes is required in non-interactive mode");
  }

  const projectData = await readProjectConfig(options.projectRoot);

  if (!hasResourcesToDeploy(projectData)) {
    return {
      outroMessage: "No resources found to deploy",
    };
  }

  const { project, entities, functions, agents, connectors, authConfig } =
    projectData;

  // Build summary of what will be deployed
  const summaryLines: string[] = [];
  if (entities.length > 0) {
    summaryLines.push(
      `  - ${entities.length} ${entities.length === 1 ? "entity" : "entities"}`,
    );
  }
  if (functions.length > 0) {
    summaryLines.push(
      `  - ${functions.length} ${functions.length === 1 ? "function" : "functions"}`,
    );
  }
  if (agents.length > 0) {
    summaryLines.push(
      `  - ${agents.length} ${agents.length === 1 ? "agent" : "agents"}`,
    );
  }
  if (connectors.length > 0) {
    summaryLines.push(
      `  - ${connectors.length} ${connectors.length === 1 ? "connector" : "connectors"}`,
    );
  }
  if (authConfig.length > 0) {
    summaryLines.push("  - Auth config");
  }
  if (project.visibility) {
    summaryLines.push(`  - Visibility: ${project.visibility}`);
  }
  if (project.site?.outputDirectory) {
    summaryLines.push(`  - Site from ${project.site.outputDirectory}`);
  }

  // Confirmation prompt
  if (!options.yes) {
    log.warn(
      `This will update your Base44 app with:\n${summaryLines.join("\n")}`,
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

  await maybeBuildBeforeDeploy(ctx, project, options.build);

  // Deploy resources with per-function progress
  let functionCompleted = 0;
  const functionTotal = functions.length;

  const result = await deployAll(projectData, {
    onVisibilitySet: (level) => {
      log.success(`App visibility set to ${level}`);
    },
    onFunctionStart: (names) => {
      const label = names.length === 1 ? names[0] : `${names.length} functions`;
      log.step(
        theme.styles.dim(
          `[${functionCompleted + 1}/${functionTotal}] Deploying ${label}...`,
        ),
      );
    },
    onFunctionResult: (r) => {
      functionCompleted++;
      formatDeployResult(r, log);
    },
  });

  // Handle connector-specific post-deploy flows
  const connectorResults = result.connectorResults ?? [];
  await handleOAuthConnectors(connectorResults, isNonInteractive, options, log);
  const stripeResult = connectorResults.find((r) => r.type === "stripe");
  if (stripeResult?.action === "provisioned") {
    printStripeResult(stripeResult as StripeSyncResult, log);
  }

  log.message(
    `${theme.styles.header("Dashboard")}: ${theme.colors.links(getDashboardUrl())}`,
  );
  if (result.appUrl) {
    log.message(
      `${theme.styles.header("App URL")}: ${theme.colors.links(result.appUrl)}`,
    );
  }

  return { outroMessage: "App deployed successfully" };
}

export function getDeployCommand(): Command {
  return new Base44Command("deploy")
    .description(
      "Deploy all project resources (entities, functions, agents, connectors, and site)",
    )
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--build", "Build the site before deploying (skips the prompt)")
    .option("--no-build", "Deploy without building (skips the prompt)")
    .action(deployAction);
}

async function handleOAuthConnectors(
  connectorResults: ConnectorSyncResult[],
  isNonInteractive: boolean,
  options: DeployOptions,
  log: Logger,
): Promise<void> {
  const needsOAuth = filterPendingOAuth(connectorResults);
  if (needsOAuth.length === 0) return;

  const oauthOutcomes = await promptOAuthFlows(needsOAuth, log, {
    skipPrompt: options.yes || isNonInteractive,
  });

  const allAuthorized =
    oauthOutcomes.size > 0 &&
    [...oauthOutcomes.values()].every((s) => s === "ACTIVE");
  if (!allAuthorized) {
    log.info(
      "Some connectors still require authorization. Run 'base44 connectors push' or open the links above in your browser.",
    );
  }
}

function printStripeResult(r: StripeSyncResult, log: Logger): void {
  log.success("Stripe sandbox provisioned");
  if (r.claimUrl) {
    log.info(`  Claim your Stripe sandbox: ${theme.colors.links(r.claimUrl)}`);
  }
  log.info(`  Connectors dashboard: ${theme.colors.links(getConnectorsUrl())}`);
}
