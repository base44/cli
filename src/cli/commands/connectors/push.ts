import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { readProjectConfig } from "@/core/index.js";
import {
  type ConnectorSyncResult,
  type IntegrationType,
  pushConnectors,
} from "@/core/resources/connector/index.js";
import {
  filterPendingOAuth,
  type OAuthFlowStatus,
  promptOAuthFlows,
} from "./oauth-prompt.js";

function printSummary(
  results: ConnectorSyncResult[],
  oauthOutcomes: Map<IntegrationType, OAuthFlowStatus>,
): void {
  const synced: IntegrationType[] = [];
  const added: IntegrationType[] = [];
  const removed: IntegrationType[] = [];
  const skipped: IntegrationType[] = [];
  const failed: { type: IntegrationType; error?: string }[] = [];

  for (const r of results) {
    const oauthStatus = oauthOutcomes.get(r.type);

    if (r.action === "synced") {
      synced.push(r.type);
    } else if (r.action === "removed") {
      removed.push(r.type);
    } else if (r.action === "error") {
      failed.push({ type: r.type, error: r.error });
    } else if (r.action === "needs_oauth") {
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
    }
  }

  log.info(theme.styles.bold("Summary:"));

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
    log.error(`Failed: ${r.type}${r.error ? ` - ${r.error}` : ""}`);
  }
}

async function pushConnectorsAction(): Promise<RunCommandResult> {
  const { connectors } = await readProjectConfig();

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

  const { results } = await runTask(
    "Pushing connectors to Base44",
    async () => {
      return await pushConnectors(connectors);
    },
  );

  const needsOAuth = filterPendingOAuth(results);
  let outroMessage = "Connectors pushed to Base44";

  const oauthOutcomes = await promptOAuthFlows(needsOAuth, {
    skipPrompt: !!process.env.CI,
  });

  const allAuthorized =
    oauthOutcomes.size > 0 &&
    [...oauthOutcomes.values()].every((s) => s === "ACTIVE");
  if (needsOAuth.length > 0 && !allAuthorized) {
    outroMessage = process.env.CI
      ? "Skipped OAuth in CI. Run 'base44 connectors push' locally or open the links above to authorize."
      : "Some connectors still require authorization. Run 'base44 connectors push' or open the links above to authorize.";
  }

  printSummary(results, oauthOutcomes);
  return { outroMessage };
}

export function getConnectorsPushCommand(context: CLIContext): Command {
  return new Command("push")
    .description(
      "Push local connectors to Base44 (overwrites connectors on Base44)",
    )
    .action(async () => {
      await runCommand(pushConnectorsAction, { requireAuth: true }, context);
    });
}
