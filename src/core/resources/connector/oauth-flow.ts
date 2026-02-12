import open from "open";
import pWaitFor, { TimeoutError } from "p-wait-for";
import { getOAuthStatus } from "./api.js";
import type { ConnectorOAuthStatus, IntegrationType } from "./schema.js";

export interface RunOAuthFlowParams {
  type: IntegrationType;
  redirectUrl: string;
  connectionId: string;
}

export interface OAuthFlowResult {
  status: ConnectorOAuthStatus;
}

/**
 * Opens the browser for OAuth authorization and polls until the status
 * changes from PENDING (or until the 2-minute timeout expires).
 */
export async function runOAuthFlow(
  params: RunOAuthFlowParams,
): Promise<OAuthFlowResult> {
  await open(params.redirectUrl);

  let finalStatus: ConnectorOAuthStatus = "PENDING";

  try {
    await pWaitFor(
      async () => {
        const response = await getOAuthStatus(params.type, params.connectionId);
        finalStatus = response.status;
        return response.status !== "PENDING";
      },
      {
        interval: 2000,
        timeout: 2 * 60 * 1000,
      },
    );
  } catch (err) {
    if (!(err instanceof TimeoutError)) {
      throw err;
    }
  }

  return { status: finalStatus };
}
