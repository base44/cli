import { confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import {
  filterPendingOAuth,
  promptOAuthFlows,
} from "@/cli/commands/connectors/oauth-prompt.js";
import { formatDeployResult } from "@/cli/commands/functions/formatDeployResult.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import {
  Base44Command,
  getConnectorsUrl,
  getDashboardUrl,
  theme,
} from "@/cli/utils/index.js";
import type { Logger } from "@/cli/utils/logger/types.js"; // used by helper functions
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
  projectRoot?: string;
}

export async function deployAction(
  { isNonInteractive, logger }: CLIContext,
  options: DeployOptions = {},
): Promise<RunCommandResult> {
  if (isNonInteractive && !options.yes) {
    throw new InvalidInputError("--yes is required in non-interactive mode");
  }

  const projectData = await readProjectConfig(options.projectRoot);

  if (!hasResourcesToDeploy(projectData)) {
    return {
      outroMessage: "No resources found to deploy",
    };
  }

  const { project, entities, functions, agents, connectors } = projectData;

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
  if (project.site?.outputDirectory) {
    summaryLines.push(`  - Site from ${project.site.outputDirectory}`);
  }

  // Confirmation prompt
  if (!options.yes) {
    logger.warn(
      `This will update your Base44 app with:\n${summaryLines.join("\n")}`,
    );

    const shouldDeploy = await confirm({
      message: "Are you sure you want to continue?",
    });

    if (isCancel(shouldDeploy) || !shouldDeploy) {
      return { outroMessage: "Deployment cancelled" };
    }
  } else {
    logger.info(`Deploying:\n${summaryLines.join("\n")}`);
  }

  // Deploy resources with per-function progress
  let functionCompleted = 0;
  const functionTotal = functions.length;

  const result = await deployAll(projectData, {
    onFunctionStart: (names) => {
      const label = names.length === 1 ? names[0] : `${names.length} functions`;
      logger.step(
        theme.styles.dim(
          `[${functionCompleted + 1}/${functionTotal}] Deploying ${label}...`,
        ),
      );
    },
    onFunctionResult: (r) => {
      functionCompleted++;
      formatDeployResult(r, logger);
    },
  });

  // Handle connector-specific post-deploy flows
  const connectorResults = result.connectorResults ?? [];
  await handleOAuthConnectors(
    connectorResults,
    isNonInteractive,
    options,
    logger,
  );
  const stripeResult = connectorResults.find((r) => r.type === "stripe");
  if (stripeResult?.action === "provisioned") {
    printStripeResult(stripeResult as StripeSyncResult, logger);
  }

  logger.message(
    `${theme.styles.header("Dashboard")}: ${theme.colors.links(getDashboardUrl())}`,
  );
  if (result.appUrl) {
    logger.message(
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
    .action(deployAction);
}

async function handleOAuthConnectors(
  connectorResults: ConnectorSyncResult[],
  isNonInteractive: boolean,
  options: DeployOptions,
  logger: Logger,
): Promise<void> {
  const needsOAuth = filterPendingOAuth(connectorResults);
  if (needsOAuth.length === 0) return;

  const oauthOutcomes = await promptOAuthFlows(needsOAuth, logger, {
    skipPrompt: options.yes || isNonInteractive,
  });

  const allAuthorized =
    oauthOutcomes.size > 0 &&
    [...oauthOutcomes.values()].every((s) => s === "ACTIVE");
  if (!allAuthorized) {
    logger.info(
      "Some connectors still require authorization. Run 'base44 connectors push' or open the links above in your browser.",
    );
  }
}

function printStripeResult(r: StripeSyncResult, logger: Logger): void {
  logger.success("Stripe sandbox provisioned");
  if (r.claimUrl) {
    logger.info(
      `  Claim your Stripe sandbox: ${theme.colors.links(r.claimUrl)}`,
    );
  }
  logger.info(
    `  Connectors dashboard: ${theme.colors.links(getConnectorsUrl())}`,
  );
}
