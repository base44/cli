import type { Logger } from "@base44-cli/logger";
import { confirm, isCancel, spinner } from "@clack/prompts";
import open from "open";
import pWaitFor, { TimeoutError } from "p-wait-for";
import { theme } from "@/cli/utils/index.js";
import type {
  ConnectorOAuthStatus,
  ConnectorSyncResult,
  IntegrationType,
  OAuthSyncResult,
} from "@/core/resources/connector/index.js";
import { getOAuthStatus } from "@/core/resources/connector/index.js";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export type OAuthFlowStatus = ConnectorOAuthStatus | "SKIPPED";

export function filterPendingOAuth(
  results: ConnectorSyncResult[],
): OAuthSyncResult[] {
  return results.filter(
    (r): r is OAuthSyncResult => r.action === "needs_oauth" && !!r.connectionId,
  );
}

interface OAuthPromptOptions {
  skipPrompt?: boolean;
}

/**
 * Clack's block() puts stdin in raw mode where Ctrl+C/Esc calls process.exit(0)
 * directly instead of emitting SIGINT. We override process.exit temporarily
 * so Ctrl+C/Esc skips the current connector instead of killing the process.
 */
async function runOAuthFlowWithSkip(
  connector: OAuthSyncResult,
): Promise<OAuthFlowStatus> {
  await open(connector.redirectUrl);

  let finalStatus = "PENDING" as OAuthFlowStatus;
  let skipped = false;

  const s = spinner();

  const originalExit = process.exit;
  process.exit = (() => {
    skipped = true;
  }) as unknown as typeof process.exit;

  s.start(`Waiting for ${connector.type} authorization... (Esc to skip)`);

  try {
    await pWaitFor(
      async () => {
        if (skipped) {
          finalStatus = "SKIPPED";
          return true;
        }
        if (!connector.connectionId) {
          finalStatus = "FAILED";
          return true;
        }
        const response = await getOAuthStatus(
          connector.type,
          connector.connectionId,
        );
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

    if (skipped) {
      s.cancel(`${connector.type} skipped`);
    } else if (finalStatus === "ACTIVE") {
      s.stop(`${connector.type} authorization complete`);
    } else if (finalStatus === "FAILED") {
      s.error(`${connector.type} authorization failed`);
    } else {
      s.error(`${connector.type} authorization timed out`);
    }
  }

  return finalStatus;
}

/**
 * Prompt the user to authorize connectors that need OAuth.
 * Returns a map of connector type → final OAuth status for each connector
 * that was processed. An empty map means either nothing needed OAuth or
 * the prompt was skipped / declined.
 */
export async function promptOAuthFlows(
  pending: OAuthSyncResult[],
  log: Logger,
  options?: OAuthPromptOptions,
): Promise<Map<IntegrationType, OAuthFlowStatus>> {
  const outcomes = new Map<IntegrationType, OAuthFlowStatus>();

  if (pending.length === 0) {
    return outcomes;
  }

  log.warn(
    `${pending.length} connector(s) require authorization in your browser:`,
  );
  for (const connector of pending) {
    log.info(`  ${connector.type}: ${theme.styles.dim(connector.redirectUrl)}`);
  }

  if (options?.skipPrompt) {
    return outcomes;
  }

  const shouldAuth = await confirm({
    message: "Open browser to authorize now?",
  });

  if (isCancel(shouldAuth) || !shouldAuth) {
    return outcomes;
  }

  for (const connector of pending) {
    try {
      log.info(`Opening browser for ${connector.type}...`);
      const status = await runOAuthFlowWithSkip(connector);
      outcomes.set(connector.type, status);
    } catch (err) {
      log.error(
        `Failed to authorize ${connector.type}: ${err instanceof Error ? err.message : String(err)}`,
      );
      outcomes.set(connector.type, "FAILED");
    }
  }

  return outcomes;
}
