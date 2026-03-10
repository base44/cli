import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  InstallStripeResponse,
  IntegrationType,
  ListAvailableIntegrationsResponse,
  ListConnectorsResponse,
  OAuthStatusResponse,
  RemoveConnectorResponse,
  RemoveStripeResponse,
  SetConnectorResponse,
  StripeStatusResponse,
} from "./schema.js";
import {
  InstallStripeResponseSchema,
  ListAvailableIntegrationsResponseSchema,
  ListConnectorsResponseSchema,
  OAuthStatusResponseSchema,
  RemoveConnectorResponseSchema,
  RemoveStripeResponseSchema,
  SetConnectorResponseSchema,
  StripeStatusResponseSchema,
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

export async function listAvailableIntegrations(): Promise<ListAvailableIntegrationsResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.get("external-auth/available-integrations");
  } catch (error) {
    throw await ApiError.fromHttpError(error, "listing available integrations");
  }

  const result = ListAvailableIntegrationsResponseSchema.safeParse(
    await response.json(),
  );

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

// ─── STRIPE-SPECIFIC ENDPOINTS ───────────────────────────────

export async function installStripe(): Promise<InstallStripeResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.post("payments/stripe/install", {
      timeout: 60_000,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "installing Stripe");
  }

  const result = InstallStripeResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data;
}

export async function getStripeStatus(): Promise<StripeStatusResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.get("payments/stripe/status", {
      timeout: 60_000,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(
      error,
      "checking Stripe integration status",
    );
  }

  const result = StripeStatusResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data;
}

export async function removeStripe(): Promise<RemoveStripeResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.delete("payments/stripe", {
      timeout: 60_000,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "removing Stripe integration");
  }

  const result = RemoveStripeResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data;
}
