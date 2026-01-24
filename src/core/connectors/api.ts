import { getAppClient } from "../clients/index.js";
import { ConnectorApiError, ConnectorValidationError } from "../errors.js";
import {
  InitiateResponseSchema,
  StatusResponseSchema,
  ListResponseSchema,
  ApiErrorSchema,
} from "./schema.js";
import type {
  InitiateResponse,
  StatusResponse,
  Connector,
} from "./schema.js";
import type { IntegrationType } from "./constants.js";

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
    throwHttpErrors: false,
  });

  const json = await response.json();

  if (!response.ok) {
    const errorResult = ApiErrorSchema.safeParse(json);
    if (errorResult.success) {
      throw new ConnectorApiError(errorResult.data.error);
    }
    throw new ConnectorApiError(
      `Failed to initiate OAuth: ${response.status} ${response.statusText}`
    );
  }

  const result = InitiateResponseSchema.safeParse(json);

  if (!result.success) {
    throw new ConnectorValidationError(
      `Invalid initiate response from server: ${result.error.message}`
    );
  }

  return result.data;
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
    throwHttpErrors: false,
  });

  const json = await response.json();

  if (!response.ok) {
    const errorResult = ApiErrorSchema.safeParse(json);
    if (errorResult.success) {
      throw new ConnectorApiError(errorResult.data.error);
    }
    throw new ConnectorApiError(
      `Failed to check OAuth status: ${response.status} ${response.statusText}`
    );
  }

  const result = StatusResponseSchema.safeParse(json);

  if (!result.success) {
    throw new ConnectorValidationError(
      `Invalid status response from server: ${result.error.message}`
    );
  }

  return result.data;
}

/**
 * Lists all connected integrations for the current app.
 */
export async function listConnectors(): Promise<Connector[]> {
  const appClient = getAppClient();

  const response = await appClient.get("external-auth/list", {
    throwHttpErrors: false,
  });

  const json = await response.json();

  if (!response.ok) {
    const errorResult = ApiErrorSchema.safeParse(json);
    if (errorResult.success) {
      throw new ConnectorApiError(errorResult.data.error);
    }
    throw new ConnectorApiError(
      `Failed to list connectors: ${response.status} ${response.statusText}`
    );
  }

  const result = ListResponseSchema.safeParse(json);

  if (!result.success) {
    throw new ConnectorValidationError(
      `Invalid list response from server: ${result.error.message}`
    );
  }

  return result.data.integrations;
}

/**
 * Disconnects (soft delete) a connector integration.
 */
export async function disconnectConnector(
  integrationType: IntegrationType
): Promise<void> {
  const appClient = getAppClient();

  const response = await appClient.delete(
    `external-auth/integrations/${integrationType}`,
    {
      throwHttpErrors: false,
    }
  );

  if (!response.ok) {
    const json = await response.json();
    const errorResult = ApiErrorSchema.safeParse(json);
    if (errorResult.success) {
      throw new ConnectorApiError(errorResult.data.error);
    }
    throw new ConnectorApiError(
      `Failed to disconnect connector: ${response.status} ${response.statusText}`
    );
  }
}

