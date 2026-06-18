import { resolve } from "node:path";
import type { Logger } from "@base44-cli/logger";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { getConnectorsUrl } from "@/cli/utils/urls.js";
import { readProjectConfig } from "@/core/index.js";
import { getAppContext } from "@/core/project/index.js";
import {
  type ConnectorResource,
  type ConnectorSyncResult,
  type IntegrationType,
  pushConnectors,
  readAllConnectors,
  type StripeSyncResult,
} from "@/core/resources/connector/index.js";
import {
  filterPendingOAuth,
  type OAuthFlowStatus,
  promptOAuthFlows,
} from "./oauth-prompt.js";

interface PushOptions {
  dir?: string;
}

/**
 * Read the local connectors to push. When the app context comes from a linked
 * project, read them from the project config. With an explicit --app-id /
 * BASE44_APP_ID there is no project (no projectRoot), so read from ./connectors
 * (overridable with --dir).
 */
async function readConnectorsToPush(
  options: PushOptions,
): Promise<ConnectorResource[]> {
  if (!getAppContext().projectRoot) {
    return readAllConnectors(resolve(options.dir ?? "connectors"));
  }
  const { connectors } = await readProjectConfig();
  return connectors;
}

function printSummary(
  results: ConnectorSyncResult[],
  oauthOutcomes: Map<IntegrationType, OAuthFlowStatus>,
  log: Logger,
): void {
  const synced: IntegrationType[] = [];
  const added: IntegrationType[] = [];
  let provisioned: StripeSyncResult | undefined;
  const removed: IntegrationType[] = [];
  const skipped: IntegrationType[] = [];
  const failed: { type: IntegrationType; error: string }[] = [];

  for (const r of results) {
    switch (r.action) {
      case "provisioned":
        provisioned = r;
        break;
      case "synced":
        synced.push(r.type);
        break;
      case "removed":
        removed.push(r.type);
        break;
      case "error":
        failed.push({ type: r.type, error: r.error });
        break;
      case "needs_oauth": {
        const oauthStatus = oauthOutcomes.get(r.type);
        if (oauthStatus === "ACTIVE") {
          added.push(r.type);
        } else if (oauthStatus === "SKIPPED") {
          skipped.push(r.type);
        } else if (oauthStatus === "PENDING") {
          failed.push({ type: r.type, error: "authorization timed out" });
        } else if (oauthStatus === "FAILED") {
          failed.push({ type: r.type, error: "authorization failed" });
        } else {
          failed.push({ type: r.type, error: "needs authorization" });
        }
        break;
      }
    }
  }

  log.info(theme.styles.bold("Summary:"));

  if (provisioned) {
    log.success("Stripe sandbox provisioned");
    if (provisioned.claimUrl) {
      log.info(
        `  Claim your Stripe sandbox: ${theme.colors.links(provisioned.claimUrl)}`,
      );
    }
    log.info(
      `  Connectors dashboard: ${theme.colors.links(getConnectorsUrl())}`,
    );
  }
  if (synced.length > 0) {
    log.success(`Synced: ${synced.join(", ")}`);
  }
  if (added.length > 0) {
    log.success(`Added: ${added.join(", ")}`);
  }
  if (removed.length > 0) {
    log.info(theme.styles.dim(`Removed: ${removed.join(", ")}`));
  }
  if (skipped.length > 0) {
    log.warn(`Skipped: ${skipped.join(", ")}`);
  }
  for (const r of failed) {
    log.error(`Failed: ${r.type} - ${r.error}`);
  }
}

async function pushConnectorsAction(
  { isNonInteractive, log, runTask, jsonMode }: CLIContext,
  options: PushOptions,
): Promise<RunCommandResult> {
  const connectors = await readConnectorsToPush(options);

  if (!jsonMode) {
    if (connectors.length === 0) {
      log.info(
        "No local connectors found - checking for remote connectors to remove",
      );
    } else {
      const connectorNames = connectors.map((c) => c.type).join(", ");
      log.info(
        `Found ${connectors.length} connectors to push: ${connectorNames}`,
      );
    }
  }

  const { results } = await runTask(
    "Pushing connectors to Base44",
    async () => {
      return await pushConnectors(connectors);
    },
  );

  const needsOAuth = filterPendingOAuth(results);
  let outroMessage = "Connectors pushed to Base44";

  const oauthOutcomes = await promptOAuthFlows(needsOAuth, log, {
    skipPrompt: isNonInteractive,
  });

  const allAuthorized =
    oauthOutcomes.size > 0 &&
    [...oauthOutcomes.values()].every((s) => s === "ACTIVE");
  if (needsOAuth.length > 0 && !allAuthorized) {
    outroMessage = isNonInteractive
      ? "Skipped OAuth in non-interactive mode. Run 'base44 connectors push' locally or open the links above to authorize."
      : "Some connectors still require authorization. Run 'base44 connectors push' or open the links above to authorize.";
  }

  if (jsonMode) {
    return {
      outroMessage,
      stdout: `${JSON.stringify(
        { results, oauth: Object.fromEntries(oauthOutcomes) },
        null,
        2,
      )}\n`,
    };
  }

  printSummary(results, oauthOutcomes, log);
  return { outroMessage };
}

export function getConnectorsPushCommand(): Command {
  return new Base44Command("push")
    .description(
      "Push local connectors to Base44 (overwrites connectors on Base44)",
    )
    .option(
      "--dir <path>",
      "Directory to read connector files from (default: ./connectors when using --app-id)",
    )
    .action(pushConnectorsAction);
}
