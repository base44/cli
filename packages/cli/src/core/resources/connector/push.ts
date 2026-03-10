import { listConnectors, removeConnector, setConnector } from "./api.js";
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

  const oauthResults = await syncOAuthConnectors(oauthConnectors);
  const stripeResult = await syncStripeConnector(stripeConnector);

  const results = [...oauthResults];
  if (stripeResult) {
    results.push(stripeResult);
  }

  return { results };
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
