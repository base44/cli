import pWaitFor from "p-wait-for";
import { checkOAuthStatus } from "./api.js";
import { OAUTH_POLL_INTERVAL_MS, OAUTH_POLL_TIMEOUT_MS } from "./constants.js";
import type { IntegrationType } from "./constants.js";

export interface OAuthCompletionResult {
  success: boolean;
  accountEmail?: string;
  error?: string;
}

/**
 * Polls for OAuth completion status.
 * Returns when status becomes ACTIVE or FAILED, or times out.
 */
export async function waitForOAuthCompletion(
  integrationType: IntegrationType,
  connectionId: string,
  options?: {
    onPending?: () => void;
  }
): Promise<OAuthCompletionResult> {
  let accountEmail: string | undefined;
  let error: string | undefined;

  try {
    await pWaitFor(
      async () => {
        const status = await checkOAuthStatus(integrationType, connectionId);

        if (status.status === "ACTIVE") {
          accountEmail = status.accountEmail ?? undefined;
          return true;
        }

        if (status.status === "FAILED") {
          error = status.error || "Authorization failed";
          throw new Error(error);
        }

        // PENDING - continue polling
        options?.onPending?.();
        return false;
      },
      {
        interval: OAUTH_POLL_INTERVAL_MS,
        timeout: OAUTH_POLL_TIMEOUT_MS,
      }
    );

    return { success: true, accountEmail };
  } catch (err) {
    if (err instanceof Error && err.message.includes("timed out")) {
      return { success: false, error: "Authorization timed out. Please try again." };
    }
    return { success: false, error: error || (err instanceof Error ? err.message : "Unknown error") };
  }
}
