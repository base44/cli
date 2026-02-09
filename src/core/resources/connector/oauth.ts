import { spinner } from "@clack/prompts";
import open from "open";
import pWaitFor, { TimeoutError } from "p-wait-for";
import { getOAuthStatus } from "./api.js";
import type { ConnectorOAuthStatus, IntegrationType } from "./schema.js";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export interface OAuthFlowParams {
  type: IntegrationType;
  redirectUrl: string;
  connectionId: string;
}

export type OAuthFlowStatus = ConnectorOAuthStatus | "SKIPPED";

export interface OAuthFlowResult {
  type: IntegrationType;
  status: OAuthFlowStatus;
}

/**
 * Clack's block() puts stdin in raw mode where Ctrl+C calls process.exit(0)
 * directly instead of emitting SIGINT. We override process.exit temporarily
 * so Ctrl+C skips the current connector instead of killing the process.
 */
export async function runOAuthFlowWithSkip(
  params: OAuthFlowParams
): Promise<OAuthFlowResult> {
  await open(params.redirectUrl);

  let finalStatus = "PENDING" as OAuthFlowStatus;
  let skipped = false;

  const s = spinner();

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
      }
    ).catch((err) => {
      if (err instanceof TimeoutError) {
        finalStatus = "PENDING";
      } else {
        throw err;
      }
    });
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
