import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import {
  SyncUserSecretsResponseSchema,
  type UserSecretDefinition,
} from "./schema.js";

export async function pushUserSecrets(definitions: UserSecretDefinition[]) {
  let response: KyResponse;
  try {
    response = await getAppClient().put("app-user-secret-definitions", {
      json: definitions.map((definition) => ({
        key: definition.name,
        label: definition.label,
        description: definition.description,
        allowed_backend_functions: definition.allowedFunctions,
      })),
    });
  } catch (error) {
    throw await ApiError.fromHttpError(
      error,
      "syncing user credential definitions",
    );
  }
  const result = SyncUserSecretsResponseSchema.safeParse(await response.json());
  if (!result.success)
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  return result.data;
}
