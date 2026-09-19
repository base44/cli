import type { KyResponse } from "ky";
import { z } from "zod";
import { base44Client, getAppClient } from "@/core/clients/index.js";
import { ApiError } from "@/core/errors.js";
import { getOAuthStatus } from "@/core/resources/connector/api.js";

/**
 * The browser half of a parked OAuth tool call. The web opens a popup and
 * approves the call only once the connection exists; the CLI does the same
 * with a link the user opens anywhere, polling the same status endpoint.
 */
const InitiateSchema = z.object({
  redirect_url: z.string().nullish(),
  connection_id: z.string().nullish(),
  integration_type: z.string().nullish(),
});

interface StartedOAuth {
  url: string;
  connectionId: string;
  integrationType: string;
}

export async function startConnectorOAuth(options: {
  integrationType: string;
  scopes?: string[] | null;
  connectorId?: string | null;
  forceReconnect?: boolean;
}): Promise<StartedOAuth> {
  let response: KyResponse;
  try {
    response = await getAppClient().post("external-auth/initiate", {
      json: {
        integration_type: options.integrationType,
        scopes: options.scopes ?? null,
        connector_id: options.connectorId ?? null,
        force_reconnect: options.forceReconnect === true,
      },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(
      error,
      "starting connector authorization",
    );
  }
  const parsed = InitiateSchema.parse(await response.json());
  if (!parsed.redirect_url || !parsed.connection_id) {
    throw new ApiError("The connector did not return an authorization link.");
  }
  return {
    url: parsed.redirect_url,
    connectionId: parsed.connection_id,
    integrationType: parsed.integration_type ?? options.integrationType,
  };
}

type OAuthOutcome = "ACTIVE" | "FAILED" | "PENDING";

/** Poll until the connection is ACTIVE or FAILED, or the deadline passes. */
export async function waitForConnectorOAuth(
  started: StartedOAuth,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<OAuthOutcome> {
  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);
  const interval = options.intervalMs ?? 3_000;
  while (Date.now() < deadline && !options.signal?.aborted) {
    const status = await getOAuthStatus(
      started.integrationType as never,
      started.connectionId,
    ).catch(() => null);
    if (status?.status === "ACTIVE" || status?.status === "FAILED") {
      return status.status;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  return "PENDING";
}

const GithubStatusSchema = z.object({ connected: z.boolean() });

/** Whether the account's GitHub connection is active (what the web checks
 * before approving connect_github_account). */
export async function githubConnected(): Promise<boolean> {
  try {
    const response = await base44Client.get("api/github/oauth/status");
    return GithubStatusSchema.parse(await response.json()).connected;
  } catch {
    return false;
  }
}
