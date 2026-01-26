import { join } from "node:path";
import { readTextFile, writeFile, writeJsonFile } from "../../utils/fs.js";
import { deployFunctions, getFunctions } from "./api.js";
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
