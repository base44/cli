import type { Resource } from "../types.js";
import type { Function } from "./schema.js";
import { readAllFunctions } from "./config.js";
import { pushFunctions } from "./deploy.js";

export const functionResource: Resource<Function> = {
  readAll: readAllFunctions,
  push: pushFunctions,
};
