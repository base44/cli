import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import {
  type ActorDeployPayload,
  ActorDeployPayloadSchema,
  type DeleteActorResponse,
  DeleteActorResponseSchema,
  type DeployActorResponse,
  DeployActorResponseSchema,
  validateActorName,
} from "@/core/resources/actor/schema.js";

export async function deploySingleActor(
  name: string,
  payload: ActorDeployPayload,
): Promise<DeployActorResponse> {
  validateActorName(name);
  const input = ActorDeployPayloadSchema.safeParse(payload);
  if (!input.success)
    throw new SchemaValidationError("Invalid actor deployment", input.error);

  let response: KyResponse;
  try {
    response = await getAppClient().put(`actors/${encodeURIComponent(name)}`, {
      json: input.data,
      timeout: false,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, `deploying actor "${name}"`);
  }
  const result = DeployActorResponseSchema.safeParse(await response.json());
  if (!result.success)
    throw new SchemaValidationError(
      "Invalid actor deployment response",
      result.error,
    );
  return result.data;
}

export async function deleteSingleActor(
  name: string,
): Promise<DeleteActorResponse> {
  validateActorName(name);
  let response: KyResponse;
  try {
    response = await getAppClient().delete(
      `actors/${encodeURIComponent(name)}`,
      { timeout: 60_000 },
    );
  } catch (error) {
    throw await ApiError.fromHttpError(error, `deleting actor "${name}"`);
  }
  const result = DeleteActorResponseSchema.safeParse(await response.json());
  if (!result.success)
    throw new SchemaValidationError(
      "Invalid actor deletion response",
      result.error,
    );
  return result.data;
}
