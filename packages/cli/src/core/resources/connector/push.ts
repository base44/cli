import { hasWorkspaceApiKeyAuth } from "@/core/auth/config.js";
import {
  listConnectors,
  removeConnector,
  setConnector,
  syncDeploymentConnectors,
} from "./api.js";
import type {
  ConnectorResource,
  IntegrationType,
  SetConnectorResponse,
} from "./schema.js";
import { STRIPE_CONNECTOR_TYPE } from "./schema.js";
import { syncStripeConnector } from "./stripe.js";

type SharedSyncResult =
  | { type: IntegrationType; action: "synced" }
  | { type: IntegrationType; action: "removed" }
  | { type: IntegrationType; action: "error"; error: string };

export type OAuthSyncResult = {
  type: IntegrationType;
  action: "needs_oauth";
  redirectUrl: string;
  connectionId?: string;
};

export type StripeSyncResult = {
  type: "stripe";
  action: "provisioned";
  claimUrl?: string;
};

export type ConnectorSyncResult =
  | SharedSyncResult
  | OAuthSyncResult
  | StripeSyncResult;

interface PushConnectorsResponse {
  results: ConnectorSyncResult[];
}

export async function pushConnectors(
  connectors: ConnectorResource[],
): Promise<PushConnectorsResponse> {
  const stripeConnector = connectors.find(
    (c) => c.type === STRIPE_CONNECTOR_TYPE,
  );
  const oauthConnectors = connectors.filter(
    (c) => c.type !== STRIPE_CONNECTOR_TYPE,
  );

  if (hasWorkspaceApiKeyAuth()) {
    return {
      results: await syncConnectorsWithWorkspaceApiKey(
        oauthConnectors,
        stripeConnector,
      ),
    };
  }

  const oauthResults = await syncOAuthConnectors(oauthConnectors);
  const stripeResult = await syncStripeConnector(stripeConnector);

  const results = [...oauthResults];
  if (stripeResult) {
    results.push(stripeResult);
  }

  return { results };
}

// Workspace API keys are rejected by the per-connector external-auth and
// Stripe routes (they need a platform user), so sync through the deployment
// endpoint, which also reconciles removals server-side.
async function syncConnectorsWithWorkspaceApiKey(
  oauthConnectors: ConnectorResource[],
  stripeConnector: ConnectorResource | undefined,
): Promise<ConnectorSyncResult[]> {
  const { connectors } = await syncDeploymentConnectors(
    oauthConnectors.map((c) => ({
      integrationType: c.type,
      scopes: c.scopes ?? [],
    })),
  );
  const results: ConnectorSyncResult[] = connectors.map((c) => ({
    type: c.integrationType,
    action: "synced",
  }));
  if (stripeConnector) {
    results.push({
      type: STRIPE_CONNECTOR_TYPE,
      action: "error",
      error:
        "Stripe connector sync is not supported with a workspace API key. Run 'base44 connectors push' as a logged-in user.",
    });
  }
  return results;
}

async function syncOAuthConnectors(
  connectors: ConnectorResource[],
): Promise<ConnectorSyncResult[]> {
  const results: ConnectorSyncResult[] = [];
  const upstream = await listConnectors();
  const localTypes = new Set(connectors.map((c) => c.type));

  // 1. Sync local connectors to remote
  for (const connector of connectors) {
    try {
      const response = await setConnector(
        connector.type,
        connector.scopes ?? [],
      );
      results.push(getConnectorSyncResult(connector.type, response));
    } catch (err) {
      results.push({
        type: connector.type,
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Remove remote connectors that are not in the local project
  for (const upstreamConnector of upstream.integrations) {
    if (!localTypes.has(upstreamConnector.integrationType)) {
      try {
        await removeConnector(upstreamConnector.integrationType);
        results.push({
          type: upstreamConnector.integrationType,
          action: "removed",
        });
      } catch (err) {
        results.push({
          type: upstreamConnector.integrationType,
          action: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return results;
}

function getConnectorSyncResult(
  type: IntegrationType,
  response: SetConnectorResponse,
): ConnectorSyncResult {
  if (response.error === "different_user") {
    return {
      type,
      action: "error",
      error:
        response.errorMessage ||
        `Already connected by ${response.otherUserEmail ?? "another user"}`,
    };
  }

  if (response.alreadyAuthorized) {
    return { type, action: "synced" };
  }

  if (response.redirectUrl) {
    return {
      type,
      action: "needs_oauth",
      redirectUrl: response.redirectUrl,
      connectionId: response.connectionId ?? undefined,
    };
  }

  return { type, action: "synced" };
}
