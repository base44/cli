import { getAppClient } from "@/core/clients/index.js";
import { DeployFunctionsResponseSchema } from "@/core/resources/function/schema.js";
import type { FunctionWithCode, DeployFunctionsResponse } from "@/core/resources/function/schema.js";

function toDeployPayloadItem(fn: FunctionWithCode) {
  return {
    name: fn.name,
    entry: fn.entry,
    files: fn.files,
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
