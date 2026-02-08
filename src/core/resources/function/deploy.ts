import { basename } from "node:path";
import { deployFunctions } from "@/core/resources/function/api.js";
import type {
  BackendFunction,
  DeployFunctionsResponse,
  FunctionFile,
  FunctionWithCode,
} from "@/core/resources/function/schema.js";
import { readTextFile } from "@/core/utils/fs.js";

async function loadFunctionCode(
  fn: BackendFunction
): Promise<FunctionWithCode> {
  const loadedFiles: FunctionFile[] = await Promise.all(
    fn.filePaths.map(async (filePath) => {
      const content = await readTextFile(filePath);
      return { path: basename(filePath), content };
    })
  );
  return { ...fn, files: loadedFiles };
}

export async function pushFunctions(
  functions: BackendFunction[]
): Promise<DeployFunctionsResponse> {
  if (functions.length === 0) {
    return { deployed: [], deleted: [], errors: null };
  }

  const functionsWithCode = await Promise.all(functions.map(loadFunctionCode));
  return deployFunctions(functionsWithCode);
}
