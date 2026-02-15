import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  IntegrationType,
  ListConnectorsResponse,
  OAuthStatusResponse,
  RemoveConnectorResponse,
  SetConnectorResponse,
} from "./schema.js";
import {
  ListConnectorsResponseSchema,
  OAuthStatusResponseSchema,
  RemoveConnectorResponseSchema,
  SetConnectorResponseSchema,
} from "./schema.js";

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
      result.error,
    );
  }

  return result.data;
}

export async function setConnector(
  integrationType: IntegrationType,
  scopes: string[],
): Promise<SetConnectorResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.put(
      `external-auth/integrations/${integrationType}`,
      {
        json: {
          scopes,
        },
      },
    );
  } catch (error) {
    throw await ApiError.fromHttpError(error, "setting connector");
  }

  const result = SetConnectorResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data;
}

export async function getOAuthStatus(
  integrationType: IntegrationType,
  connectionId: string,
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
      result.error,
    );
  }

  return result.data;
}

export async function removeConnector(
  integrationType: IntegrationType,
): Promise<RemoveConnectorResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.delete(
      `external-auth/integrations/${integrationType}/remove`,
    );
  } catch (error) {
    throw await ApiError.fromHttpError(error, "removing connector");
  }

  const result = RemoveConnectorResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data;
}
