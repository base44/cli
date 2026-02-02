import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  InitiateOAuthRequest,
  InitiateOAuthResponse,
  IntegrationType,
  ListConnectorsResponse,
  OAuthStatusResponse,
} from "@/core/resources/connector/schema.js";
import {
  InitiateOAuthResponseSchema,
  ListConnectorsResponseSchema,
  OAuthStatusResponseSchema,
} from "@/core/resources/connector/schema.js";

/**
 * List all connectors for the current app
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

/**
 * Initiate OAuth flow for a connector
 */
export async function initiateOAuth(
  request: InitiateOAuthRequest
): Promise<InitiateOAuthResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.post("external-auth/initiate", {
      json: request,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "initiating OAuth flow");
  }

  const result = InitiateOAuthResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error
    );
  }

  return result.data;
}

/**
 * Poll OAuth status
 */
export async function pollOAuthStatus(
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
    throw await ApiError.fromHttpError(error, "polling OAuth status");
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

/**
 * Hard delete a connector (removes completely from upstream)
 */
export async function deleteConnector(
  integrationType: IntegrationType
): Promise<void> {
  const appClient = getAppClient();

  try {
    await appClient.delete(
      `external-auth/integrations/${integrationType}/remove`
    );
  } catch (error) {
    throw await ApiError.fromHttpError(error, "deleting connector");
  }
}
