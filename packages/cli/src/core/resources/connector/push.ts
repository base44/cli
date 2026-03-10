import {
  getStripeStatus,
  installStripe,
  listConnectors,
  removeConnector,
  removeStripe,
  setConnector,
} from "./api.js";
import type {
  ConnectorResource,
  IntegrationType,
  SetConnectorResponse,
  StripeStatusResponse,
} from "./schema.js";
import { STRIPE_CONNECTOR_TYPE } from "./schema.js";

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

async function syncStripeConnector(
  localStripe: ConnectorResource | undefined,
): Promise<ConnectorSyncResult | null> {
  const remoteStatus = await fetchStripeRemoteStatus();

  if (remoteStatus === "error") {
    return localStripe
      ? stripeError("Failed to check Stripe integration status")
      : null;
  }

  const isRemoteInstalled = remoteStatus.stripeMode !== null;
  const needsInstall = localStripe && !isRemoteInstalled;
  const alreadySynced = localStripe && isRemoteInstalled;
  const needsRemoval = !localStripe && isRemoteInstalled;

  if (needsInstall) {
    return handleStripeInstall();
  }

  if (alreadySynced) {
    return stripeSynced();
  }

  if (needsRemoval) {
    return handleStripeRemoval();
  }

  return null;
}

async function fetchStripeRemoteStatus(): Promise<
  StripeStatusResponse | "error"
> {
  try {
    return await getStripeStatus();
  } catch {
    return "error";
  }
}

async function handleStripeInstall(): Promise<ConnectorSyncResult> {
  try {
    const result = await installStripe();
    return stripeProvisioned(result.claimUrl ?? undefined);
  } catch (err) {
    return stripeError(err instanceof Error ? err.message : String(err));
  }
}

async function handleStripeRemoval(): Promise<ConnectorSyncResult> {
  try {
    await removeStripe();
    return stripeRemoved();
  } catch (err) {
    return stripeError(err instanceof Error ? err.message : String(err));
  }
}

function stripeSynced(): SharedSyncResult {
  return { type: STRIPE_CONNECTOR_TYPE, action: "synced" };
}

function stripeProvisioned(claimUrl?: string): StripeSyncResult {
  return { type: STRIPE_CONNECTOR_TYPE, action: "provisioned", claimUrl };
}

function stripeRemoved(): SharedSyncResult {
  return { type: STRIPE_CONNECTOR_TYPE, action: "removed" };
}

function stripeError(error: string): SharedSyncResult {
  return { type: STRIPE_CONNECTOR_TYPE, action: "error", error };
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
