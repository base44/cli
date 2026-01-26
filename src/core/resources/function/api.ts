import { getAppClient } from "@core/clients/index.js";
import { DeployFunctionsResponseSchema, GetFunctionsResponseSchema } from "./schema.js";
import type { FunctionWithCode, DeployFunctionsResponse, GetFunctionsResponse } from "./schema.js";

function toDeployPayloadItem(fn: FunctionWithCode) {
  return {
    name: fn.name,
    entry: fn.entry,
    files: [{ path: fn.entry, content: fn.code }],
  };
}

export async function deployFunctions(
  functions: FunctionWithCode[]
): Promise<DeployFunctionsResponse> {
  const appClient = getAppClient();
  const payload = {
    functions: functions.map(toDeployPayloadItem),
  };

  const response = await appClient.put("backend-functions", {
    json: payload,
    timeout: 120_000
  });

  const result = DeployFunctionsResponseSchema.parse(await response.json());
  return result;
}

export async function getFunctions(): Promise<GetFunctionsResponse> {
  const appClient = getAppClient();
  const response = await appClient.get("backend-functions");
  const result = GetFunctionsResponseSchema.parse(await response.json());
  
  return result;
}
