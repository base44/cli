import { getAppClient } from "@core/clients/index.js";
import type { FunctionWithCode, DeployFunctionsResponse, GetFunctionsResponse } from "./schema.js";
import type { KyResponse } from "ky";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import { DeployFunctionsResponseSchema, GetFunctionsResponseSchema } from "@/core/resources/function/schema.js";

function toDeployPayloadItem(fn: FunctionWithCode) {
  return {
    name: fn.name,
    entry: fn.entry,
    files: fn.files,
    automations: fn.automations,
  };
}

export async function deployFunctions(
  functions: FunctionWithCode[]
): Promise<DeployFunctionsResponse> {
  const appClient = getAppClient();
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

export async function getFunctions(): Promise<GetFunctionsResponse> {
  const appClient = getAppClient();
  const response = await appClient.get("backend-functions");
  const result = GetFunctionsResponseSchema.parse(await response.json());
  
  return result;
}
