import { basename } from "node:path";
import { readTextFile } from "@/core/utils/fs.js";
import { deployFunctions } from "@/core/resources/function/api.js";
import type { Function, FunctionWithCode, DeployFunctionsResponse, FunctionFile } from "@/core/resources/function/schema.js";

async function loadFunctionCode(fn: Function): Promise<FunctionWithCode> {
  const loadedFiles: FunctionFile[] = await Promise.all(
    fn.files.map(async (filePath) => {
      const content = await readTextFile(filePath);
      return { path: basename(filePath), content };
    })
  );
  return { ...fn, files: loadedFiles };
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
