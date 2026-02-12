import { confirm, isCancel, log } from "@clack/prompts";
import { Command } from "commander";
import open from "open";
import pWaitFor, { TimeoutError } from "p-wait-for";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { readProjectConfig } from "@/core/index.js";
import {
  type ConnectorOAuthStatus,
  type ConnectorSyncResult,
  getOAuthStatus,
  type IntegrationType,
  pushConnectors,
} from "@/core/resources/connector/index.js";

type PendingOAuthResult = ConnectorSyncResult & {
  redirectUrl: string;
  connectionId: string;
};

function isPendingOAuth(r: ConnectorSyncResult): r is PendingOAuthResult {
  return r.action === "needs_oauth" && !!r.redirectUrl && !!r.connectionId;
}

function printSummary(
  results: ConnectorSyncResult[],
  oauthOutcomes: Map<IntegrationType, ConnectorOAuthStatus>,
): void {
  const synced: IntegrationType[] = [];
  const added: IntegrationType[] = [];
  const removed: IntegrationType[] = [];
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
      } else if (oauthStatus === "PENDING") {
        failed.push({ type: r.type, error: "authorization timed out" });
      } else if (oauthStatus === "FAILED") {
        failed.push({ type: r.type, error: "authorization failed" });
      } else {
        failed.push({ type: r.type, error: "needs authorization" });
      }
    }
  }

  log.info("");
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

  const oauthOutcomes = new Map<IntegrationType, ConnectorOAuthStatus>();
  const needsOAuth = results.filter(isPendingOAuth);
  let outroMessage = "Connectors pushed to Base44";

  if (needsOAuth.length === 0) {
    printSummary(results, oauthOutcomes);
    return { outroMessage };
  }

  log.warn(
    `${needsOAuth.length} connector(s) require authorization in your browser:`,
  );
  for (const connector of needsOAuth) {
    log.info(
      `  '${connector.type}': ${theme.styles.dim(connector.redirectUrl)}`,
    );
  }

  const pending = needsOAuth.map((c) => c.type).join(", ");

  if (process.env.CI) {
    outroMessage = `Skipped OAuth in CI. Pending: ${pending}. Run 'base44 connectors push' locally to authorize.`;
  } else {
    const shouldAuth = await confirm({
      message: "Open browser to authorize now?",
    });

    if (isCancel(shouldAuth) || !shouldAuth) {
      outroMessage = `Authorization skipped. Pending: ${pending}. Run 'base44 connectors push' again to complete.`;
    } else {
      for (const connector of needsOAuth) {
        try {
          log.info(`\nOpening browser for '${connector.type}'...`);
          await open(connector.redirectUrl);

          let finalStatus: ConnectorOAuthStatus = "PENDING";

          await runTask(
            `Waiting for '${connector.type}' authorization...`,
            async () => {
              await pWaitFor(
                async () => {
                  const response = await getOAuthStatus(
                    connector.type,
                    connector.connectionId,
                  );
                  finalStatus = response.status;
                  return response.status !== "PENDING";
                },
                {
                  interval: 2000,
                  timeout: 2 * 60 * 1000,
                },
              );
            },
            {
              successMessage: `'${connector.type}' authorization complete`,
              errorMessage: `'${connector.type}' authorization failed`,
            },
          ).catch((err) => {
            if (err instanceof TimeoutError) {
              finalStatus = "PENDING";
            } else {
              throw err;
            }
          });

          oauthOutcomes.set(connector.type, finalStatus);
        } catch (err) {
          log.error(
            `Failed to authorize '${connector.type}': ${err instanceof Error ? err.message : String(err)}`,
          );
          oauthOutcomes.set(connector.type, "FAILED");
        }
      }
    }
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
