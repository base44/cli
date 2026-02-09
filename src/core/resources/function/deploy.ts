import { join } from "node:path";
import { basename } from "node:path";
import { deployFunctions, getFunctions } from "@/core/resources/function/api.js";
import type {
  BackendFunction,
  DeployFunctionsResponse,
  FunctionFile,
  FunctionWithCode,
} from "@/core/resources/function/schema.js";
import { readTextFile, writeFile, writeJsonFile } from "@/core/utils/fs.js";

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
    return { deployed: [], deleted: [], skipped: [], errors: null };
  }

  const functionsWithCode = await Promise.all(functions.map(loadFunctionCode));
  return deployFunctions(functionsWithCode);
}

export async function pullFunctions(projectPath: string): Promise<FunctionWithCode[]> {
  const { functions } = await getFunctions();

  functions.forEach((func) => {
    const functionDir = join(projectPath, 'base44', 'functions', func.name);

    writeJsonFile(join(functionDir, 'function.json'), { name: func.name, entry: 'index.js' });
    writeFile(join(functionDir, 'index.js'), func.code);
  });

  return functions.map((func) => ({
    name: func.name,
    entry: 'index.js',
    triggers: [],
    code: func.code,
    codePath: join(projectPath, 'base44', 'functions', func.name, 'index.js')
  }))
}
