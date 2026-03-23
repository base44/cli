import type { KyResponse } from "ky";
import { base44Client } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import { getAppConfig } from "@/core/project/index.js";
import type { AuthConfig } from "./schema.js";
import { AppAuthConfigResponseSchema, toAuthConfigPayload } from "./schema.js";

/**
 * Fetches the current auth config for the app.
 */
export async function getAuthConfig(): Promise<AuthConfig> {
  const { id } = getAppConfig();

  let response: KyResponse;
  try {
    response = await base44Client.get(`api/apps/${id}`);
  } catch (error) {
    throw await ApiError.fromHttpError(error, "fetching auth config");
  }

  const result = AppAuthConfigResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data.authConfig;
}

/**
 * Pushes the full auth config to the API.
 */
export async function pushAuthConfigToApi(
  config: AuthConfig,
): Promise<AuthConfig> {
  const { id } = getAppConfig();

  let response: KyResponse;
  try {
    response = await base44Client.put(`api/apps/${id}`, {
      json: { auth_config: toAuthConfigPayload(config) },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "updating auth config");
  }

  const result = AppAuthConfigResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data.authConfig;
}
