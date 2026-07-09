import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type { DeployActorResponse } from "@/core/resources/actor/schema.js";
import { DeployActorResponseSchema } from "@/core/resources/actor/schema.js";
import type { FunctionFile } from "@/core/resources/function/schema.js";

export async function deploySingleActor(
  name: string,
  payload: { entry: string; files: FunctionFile[] },
): Promise<DeployActorResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.put(`actors/${encodeURIComponent(name)}`, {
      json: payload,
      timeout: false,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, `deploying actor "${name}"`);
  }

  const result = DeployActorResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data;
}
