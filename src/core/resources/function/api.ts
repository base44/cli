import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  DeployFunctionsResponse,
  FunctionWithCode,
} from "@/core/resources/function/schema.js";
import { DeployFunctionsResponseSchema } from "@/core/resources/function/schema.js";

function toDeployPayloadItem(fn: FunctionWithCode) {
  return {
    name: fn.name,
    entry: fn.entry,
    files: fn.files,
    automations: fn.automations,
  };
}

export async function deployFunctions(
  functions: FunctionWithCode[],
): Promise<DeployFunctionsResponse> {
  const appClient = getAppClient();
  const payload = {
    functions: functions.map(toDeployPayloadItem),
  };

  let response: KyResponse;
  try {
    response = await appClient.put("backend-functions", {
      json: payload,
      timeout: false,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "deploying functions");
  }

  const result = DeployFunctionsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data;
}
