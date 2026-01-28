import { getAppClient } from "../clients/index.js";
import {
  InitiateResponseSchema,
  StatusResponseSchema,
  ListResponseSchema,
} from "./schema.js";
import type {
  InitiateResponse,
  StatusResponse,
  Connector,
} from "./schema.js";
import type { IntegrationType } from "./consts.js";

/**
 * Initiates OAuth flow for a connector integration.
 * Returns a redirect URL to open in the browser.
 */
export async function initiateOAuth(
  integrationType: IntegrationType,
  scopes: string[] | null = null
): Promise<InitiateResponse> {
  const appClient = getAppClient();

  const response = await appClient.post("external-auth/initiate", {
    json: {
      integration_type: integrationType,
      scopes,
    },
  });

  const json = await response.json();
  return InitiateResponseSchema.parse(json);
}

/**
 * Checks the status of an OAuth connection attempt.
 */
export async function checkOAuthStatus(
  integrationType: IntegrationType,
  connectionId: string
): Promise<StatusResponse> {
  const appClient = getAppClient();

  const response = await appClient.get("external-auth/status", {
    searchParams: {
      integration_type: integrationType,
      connection_id: connectionId,
    },
  });

  const json = await response.json();
  return StatusResponseSchema.parse(json);
}

/**
 * Lists all connected integrations for the current app.
 */
export async function listConnectors(): Promise<Connector[]> {
  const appClient = getAppClient();

  const response = await appClient.get("external-auth/list");

  const json = await response.json();
  const result = ListResponseSchema.parse(json);
  return result.integrations;
}

/**
 * Disconnects (soft delete) a connector integration.
 */
export async function disconnectConnector(
  integrationType: IntegrationType
): Promise<void> {
  const appClient = getAppClient();

  await appClient.delete(`external-auth/integrations/${integrationType}`);
}

/**
 * Removes (hard delete) a connector integration.
 * This permanently removes the connector and cannot be undone.
 */
export async function removeConnector(
  integrationType: IntegrationType
): Promise<void> {
  const appClient = getAppClient();

  await appClient.delete(
    `external-auth/integrations/${integrationType}/remove`
  );
}

