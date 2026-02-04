import {
  listConnectors,
  removeConnector,
  syncConnector,
} from "./api.js";
import type {
  ConnectorResource,
  IntegrationType,
  SyncConnectorResponse,
} from "./schema.js";

export interface ConnectorSyncResult {
  type: IntegrationType;
  action: "synced" | "removed" | "needs_oauth" | "error";
  redirectUrl?: string;
  connectionId?: string;
  error?: string;
}

export interface PushConnectorsResponse {
  results: ConnectorSyncResult[];
}

export async function pushConnectors(
  connectors: ConnectorResource[]
): Promise<PushConnectorsResponse> {
  const results: ConnectorSyncResult[] = [];
  const upstream = await listConnectors();
  const localTypes = new Set(connectors.map((c) => c.type));

  for (const connector of connectors) {
    try {
      const response = await syncConnector(connector.type, connector.scopes);
      results.push(syncResponseToResult(connector.type, response));
    } catch (err) {
      results.push({
        type: connector.type,
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const upstreamConnector of upstream.integrations) {
    if (!localTypes.has(upstreamConnector.integration_type)) {
      try {
        await removeConnector(upstreamConnector.integration_type);
        results.push({
          type: upstreamConnector.integration_type,
          action: "removed",
        });
      } catch (err) {
        results.push({
          type: upstreamConnector.integration_type,
          action: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return { results };
}

function syncResponseToResult(
  type: IntegrationType,
  response: SyncConnectorResponse
): ConnectorSyncResult {
  if (response.error === "different_user") {
    return {
      type,
      action: "error",
      error: response.error_message || `Already connected by ${response.other_user_email}`,
    };
  }

  if (response.already_authorized) {
    return { type, action: "synced" };
  }

  if (response.redirect_url) {
    return {
      type,
      action: "needs_oauth",
      redirectUrl: response.redirect_url,
      connectionId: response.connection_id ?? undefined,
    };
  }

  return { type, action: "synced" };
}
