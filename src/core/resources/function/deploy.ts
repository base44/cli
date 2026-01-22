import { readTextFile } from "../../utils/fs.js";
import { deployFunctions } from "./api.js";
import type { Function, FunctionWithCode, DeployFunctionsResponse } from "./schema.js";

async function loadFunctionCode(fn: Function): Promise<FunctionWithCode> {
  const code = await readTextFile(fn.codePath);
  return { ...fn, code };
}

export async function pushFunctions(
  functions: Function[]
): Promise<DeployFunctionsResponse> {
  if (functions.length === 0) {
    return { deployed: [], deleted: [], errors: null };
  }

  const functionsWithCode = await Promise.all(functions.map(loadFunctionCode));
  return deployFunctions(functionsWithCode);
}
