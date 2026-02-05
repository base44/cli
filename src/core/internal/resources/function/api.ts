import type { KyInstance, KyResponse } from "ky";
import { getAppClient } from "@/core/internal/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/internal/errors.js";
import type {
  DeployFunctionsResponse,
  FunctionDeploy,
} from "@/core/internal/resources/function/schema.js";
import { DeployFunctionsResponseSchema } from "@/core/internal/resources/function/schema.js";

function toDeployPayloadItem(fn: FunctionDeploy) {
  return {
    name: fn.name,
    entry: fn.entry,
    files: fn.files,
  };
}

export async function deployFunctions(
  functions: FunctionDeploy[],
  client?: KyInstance
): Promise<DeployFunctionsResponse> {
  const appClient = client ?? getAppClient();
  const payload = {
    functions: functions.map(toDeployPayloadItem),
  };

  let response: KyResponse;
  try {
    response = await appClient.put("backend-functions", {
      json: payload,
      timeout: 120_000,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "deploying functions");
  }

  const result = DeployFunctionsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error
    );
  }

  return result.data;
}
