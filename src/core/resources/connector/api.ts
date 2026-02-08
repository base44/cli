import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  IntegrationType,
  ListConnectorsResponse,
  OAuthStatusResponse,
  RemoveConnectorResponse,
  SyncConnectorResponse,
} from "./schema.js";
import {
  ListConnectorsResponseSchema,
  OAuthStatusResponseSchema,
  RemoveConnectorResponseSchema,
  SyncConnectorResponseSchema,
} from "./schema.js";

/**
 * List all connectors for the current app.
 * GET /api/apps/{app_id}/external-auth/list
 */
export async function listConnectors(): Promise<ListConnectorsResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.get("external-auth/list");
  } catch (error) {
    throw await ApiError.fromHttpError(error, "listing connectors");
  }

  const result = ListConnectorsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error
    );
  }

  return result.data;
}

export async function syncConnector(
  integrationType: IntegrationType,
  scopes: string[]
): Promise<SyncConnectorResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.post("external-auth/sync", {
      json: {
        integration_type: integrationType,
        scopes,
      },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "syncing connector");
  }

  const result = SyncConnectorResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error
    );
  }

  return result.data;
}

export async function getOAuthStatus(
  integrationType: IntegrationType,
  connectionId: string
): Promise<OAuthStatusResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.get("external-auth/status", {
      searchParams: {
        integration_type: integrationType,
        connection_id: connectionId,
      },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "checking OAuth status");
  }

  const result = OAuthStatusResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error
    );
  }

  return result.data;
}

export async function removeConnector(
  integrationType: IntegrationType
): Promise<RemoveConnectorResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.delete(
      `external-auth/integrations/${integrationType}/remove`
    );
  } catch (error) {
    throw await ApiError.fromHttpError(error, "removing connector");
  }

  const result = RemoveConnectorResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error
    );
  }

  return result.data;
}
