import { confirm, isCancel, log, spinner } from "@clack/prompts";
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

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

interface OAuthFlowParams {
  type: IntegrationType;
  redirectUrl: string;
  connectionId: string;
}

type OAuthFlowStatus = ConnectorOAuthStatus | "SKIPPED";

interface OAuthFlowResult {
  type: IntegrationType;
  status: OAuthFlowStatus;
}

/**
 * Clack's block() puts stdin in raw mode where Ctrl+C calls process.exit(0)
 * directly instead of emitting SIGINT. We override process.exit temporarily
 * so Ctrl+C skips the current connector instead of killing the process.
 */
async function runOAuthFlowWithSkip(
  params: OAuthFlowParams,
): Promise<OAuthFlowResult> {
  await open(params.redirectUrl);

  let finalStatus = "PENDING" as OAuthFlowStatus;
  let skipped = false;

  const s = spinner();

  // Clack's spinner calls block() which puts stdin in raw mode — Esc/Ctrl+C
  // calls process.exit(0) directly, bypassing SIGINT. Override to skip instead.
  const originalExit = process.exit;
  process.exit = (() => {
    skipped = true;
    s.stop(`${params.type} skipped`);
  }) as unknown as typeof process.exit;

  s.start(`Waiting for ${params.type} authorization... (Esc to skip)`);

  try {
    await pWaitFor(
      async () => {
        if (skipped) {
          finalStatus = "SKIPPED";
          return true;
        }
        const response = await getOAuthStatus(params.type, params.connectionId);
        finalStatus = response.status;
        return response.status !== "PENDING";
      },
      {
        interval: POLL_INTERVAL_MS,
        timeout: POLL_TIMEOUT_MS,
      },
    );
  } catch (err) {
    if (err instanceof TimeoutError) {
      finalStatus = "PENDING";
    } else {
      throw err;
    }
  } finally {
    process.exit = originalExit;

    if (!skipped) {
      if (finalStatus === "ACTIVE") {
        s.stop(`${params.type} authorization complete`);
      } else if (finalStatus === "FAILED") {
        s.stop(`${params.type} authorization failed`);
      } else {
        s.stop(`${params.type} authorization timed out`);
      }
    }
  }

  return { type: params.type, status: finalStatus };
}

type PendingOAuthResult = ConnectorSyncResult & {
  redirectUrl: string;
  connectionId: string;
};

function isPendingOAuth(r: ConnectorSyncResult): r is PendingOAuthResult {
  return r.action === "needs_oauth" && !!r.redirectUrl && !!r.connectionId;
}

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

  const oauthOutcomes = new Map<IntegrationType, OAuthFlowStatus>();
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

          const oauthResult = await runOAuthFlowWithSkip({
            type: connector.type,
            redirectUrl: connector.redirectUrl,
            connectionId: connector.connectionId,
          });

          oauthOutcomes.set(connector.type, oauthResult.status);
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
