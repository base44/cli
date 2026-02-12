import { confirm, isCancel, log } from "@clack/prompts";
import open from "open";
import pWaitFor, { TimeoutError } from "p-wait-for";
import { runTask, theme } from "@/cli/utils/index.js";
import type {
  ConnectorOAuthStatus,
  ConnectorSyncResult,
  IntegrationType,
} from "@/core/resources/connector/index.js";
import { getOAuthStatus } from "@/core/resources/connector/index.js";

export type PendingOAuthResult = ConnectorSyncResult & {
  redirectUrl: string;
  connectionId: string;
};

export function filterPendingOAuth(
  results: ConnectorSyncResult[]
): PendingOAuthResult[] {
  return results.filter(
    (r): r is PendingOAuthResult =>
      r.action === "needs_oauth" && !!r.redirectUrl && !!r.connectionId
  );
}

export interface OAuthPromptOptions {
  skipPrompt?: boolean;
}

/**
 * Prompt the user to authorize connectors that need OAuth.
 * Returns a map of connector type → final OAuth status for each connector
 * that was processed. An empty map means either nothing needed OAuth or
 * the prompt was skipped / declined.
 */
export async function promptOAuthFlows(
  pending: PendingOAuthResult[],
  options?: OAuthPromptOptions
): Promise<Map<IntegrationType, ConnectorOAuthStatus>> {
  const outcomes = new Map<IntegrationType, ConnectorOAuthStatus>();

  if (pending.length === 0) {
    return outcomes;
  }

  log.info("");
  log.warn(
    `${pending.length} connector(s) require authorization in your browser:`
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
    log.info(`\nOpening browser for ${connector.type}...`);
    await open(connector.redirectUrl);

    let finalStatus: ConnectorOAuthStatus = "PENDING";

    await runTask(
      `Waiting for ${connector.type} authorization...`,
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
        successMessage: `${connector.type} authorization complete`,
        errorMessage: `${connector.type} authorization failed`,
      },
    ).catch((err) => {
      if (err instanceof TimeoutError) {
        finalStatus = "PENDING";
      } else {
        throw err;
      }
    });

    outcomes.set(connector.type, finalStatus);
  }

  return outcomes;
}
