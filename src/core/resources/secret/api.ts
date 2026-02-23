import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  DeleteSecretResponse,
  ListSecretsResponse,
  SetSecretsResponse,
} from "./schema.js";
import {
  DeleteSecretResponseSchema,
  ListSecretsResponseSchema,
  SetSecretsResponseSchema,
} from "./schema.js";

export async function listSecrets(): Promise<ListSecretsResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.get("secrets");
  } catch (error) {
    throw await ApiError.fromHttpError(error, "listing secrets");
  }

  const result = ListSecretsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data;
}

export async function setSecrets(
  secrets: Record<string, string>,
): Promise<SetSecretsResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.post("secrets", {
      json: secrets,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "setting secrets");
  }

  const result = SetSecretsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data;
}

export async function deleteSecret(
  name: string,
): Promise<DeleteSecretResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.delete("secrets", {
      searchParams: { secret_name: name },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "deleting secret");
  }

  const result = DeleteSecretResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data;
}
