import { readAllFunctions } from "@/core/resources/function/config.js";
import { deployFunctionsSequentially } from "@/core/resources/function/deploy.js";
import type { BackendFunction } from "@/core/resources/function/schema.js";
import { type Resource, throwIfDeployFailed } from "@/core/resources/types.js";

export const functionResource: Resource<BackendFunction> = {
  readAll: readAllFunctions,
  push: async (functions) => {
    const results = await deployFunctionsSequentially(functions);
    throwIfDeployFailed(results, "function");
    return results;
  },
};
