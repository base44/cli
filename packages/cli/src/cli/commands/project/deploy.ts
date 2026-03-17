import { confirm, isCancel, log } from "@clack/prompts";
import { Command } from "commander";
import {
  filterPendingOAuth,
  promptOAuthFlows,
} from "@/cli/commands/connectors/oauth-prompt.js";
import { formatDeployResult } from "@/cli/commands/functions/formatDeployResult.js";
import type { CLIContext } from "@/cli/types.js";
import {
  getConnectorsUrl,
  getDashboardUrl,
  runCommand,
  theme,
} from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
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
  isNonInteractive?: boolean;
}

export async function deployAction(
  options: DeployOptions,
): Promise<RunCommandResult> {
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

  // Deploy resources with per-function progress
  let functionCompleted = 0;
  const functionTotal = functions.length;

  const result = await deployAll(projectData, {
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
      formatDeployResult(r);
    },
  });

  // Handle connector-specific post-deploy flows
  const connectorResults = result.connectorResults ?? [];
  await handleOAuthConnectors(connectorResults, options);
  const stripeResult = connectorResults.find((r) => r.type === "stripe");
  if (stripeResult?.action === "provisioned") {
    printStripeResult(stripeResult as StripeSyncResult);
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

export function getDeployCommand(context: CLIContext): Command {
  return new Command("deploy")
    .description(
      "Deploy all project resources (entities, functions, agents, connectors, and site)",
    )
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (options: DeployOptions) => {
      await runCommand(
        () =>
          deployAction({
            ...options,
            isNonInteractive: context.isNonInteractive,
          }),
        { requireAuth: true },
        context,
      );
    });
}

async function handleOAuthConnectors(
  connectorResults: ConnectorSyncResult[],
  options: DeployOptions,
): Promise<void> {
  const needsOAuth = filterPendingOAuth(connectorResults);
  if (needsOAuth.length === 0) return;

  const oauthOutcomes = await promptOAuthFlows(needsOAuth, {
    skipPrompt: options.yes || options.isNonInteractive,
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

function printStripeResult(r: StripeSyncResult): void {
  log.success("Stripe sandbox provisioned");
  if (r.claimUrl) {
    log.info(`  Claim your Stripe sandbox: ${theme.colors.links(r.claimUrl)}`);
  }
  log.info(`  Connectors dashboard: ${theme.colors.links(getConnectorsUrl())}`);
}
