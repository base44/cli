import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type { FunctionFile } from "@/core/resources/function/schema.js";
import type { DeployRealtimeHandlerResponse } from "@/core/resources/realtime-handler/schema.js";
import { DeployRealtimeHandlerResponseSchema } from "@/core/resources/realtime-handler/schema.js";

export async function deploySingleRealtimeHandler(
  name: string,
  payload: { entry: string; files: FunctionFile[] },
): Promise<DeployRealtimeHandlerResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.put(
      `backend-functions/${encodeURIComponent(name)}`,
      { json: payload, timeout: false },
    );
  } catch (error) {
    throw await ApiError.fromHttpError(
      error,
      `deploying realtime handler "${name}"`,
    );
  }

  const result = DeployRealtimeHandlerResponseSchema.safeParse(
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
