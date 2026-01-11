import type { Resource } from "@core/project/baseResource.js";
import type { FunctionConfig } from "./schema.js";
import { readAllFunctions } from "./config.js";

export const functionResource: Resource<FunctionConfig> = {
  readAll: readAllFunctions,
};
