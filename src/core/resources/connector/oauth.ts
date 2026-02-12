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

interface OAuthFlowResult {
  type: IntegrationType;
  status: ConnectorOAuthStatus;
}

export async function runOAuthFlow(
  params: OAuthFlowParams
): Promise<OAuthFlowResult> {
  await open(params.redirectUrl);

  let finalStatus: ConnectorOAuthStatus = "PENDING";

  await pWaitFor(
    async () => {
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

  return { type: params.type, status: finalStatus };
}
