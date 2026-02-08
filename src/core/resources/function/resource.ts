import { readAllFunctions } from "@/core/resources/function/config.js";
import { pushFunctions } from "@/core/resources/function/deploy.js";
import type { BackendFunction } from "@/core/resources/function/schema.js";
import type { Resource } from "@/core/resources/types.js";

export const functionResource: Resource<BackendFunction> = {
  readAll: readAllFunctions,
  push: pushFunctions,
};
