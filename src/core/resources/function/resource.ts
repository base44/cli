import type { Resource } from "@/core/resources/types.js";
import type { Function } from "@/core/resources/function/schema.js";
import { readAllFunctions } from "@/core/resources/function/config.js";
import { pushFunctions } from "@/core/resources/function/deploy.js";

export const functionResource: Resource<Function> = {
  readAll: readAllFunctions,
  push: pushFunctions,
};
