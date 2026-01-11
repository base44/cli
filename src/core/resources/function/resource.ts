import type { Resource } from "@core/config/baseResource.js";
import type { FunctionConfig } from "./schema.js";
import { readAllFunctions } from "./config.js";

export const functionResource: Resource<FunctionConfig> = {
  readAll: readAllFunctions,
};
