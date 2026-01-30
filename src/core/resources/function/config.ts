import { dirname, join } from "node:path";
import { globby } from "globby";
import { FUNCTION_CONFIG_FILE } from "@/core/consts.js";
import { readJsonFile, pathExists } from "@/core/utils/fs.js";
import { FunctionConfigSchema, FunctionSchema } from "@/core/resources/function/schema.js";
import type { FunctionConfig, Function } from "@/core/resources/function/schema.js";
import { SchemaValidationError, FileNotFoundError } from "@/core/errors.js";

export async function readFunctionConfig(
  configPath: string
): Promise<FunctionConfig> {
  const parsed = await readJsonFile(configPath);
  const result = FunctionConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw new SchemaValidationError(`Invalid function configuration in ${configPath}`, result.error);
  }

  return result.data;
}

export async function readFunction(configPath: string): Promise<Function> {
  const config = await readFunctionConfig(configPath);
  const functionDir = dirname(configPath);
  const entryPath = join(functionDir, config.entry);

  if (!(await pathExists(entryPath))) {
    throw new FileNotFoundError(
      `Function entry file not found: ${entryPath} (referenced in ${configPath})`
    );
  }

  const files = await globby("*.{js,ts,json}", {
    cwd: functionDir,
    absolute: true,
  });

  const functionData = { ...config, entryPath, files };
  const result = FunctionSchema.safeParse(functionData);
  if (!result.success) {
    throw new SchemaValidationError(`Invalid function in ${configPath}`, result.error);
  }

  return result.data;
}

export async function readAllFunctions(
  functionsDir: string
): Promise<Function[]> {
  if (!(await pathExists(functionsDir))) {
    return [];
  }

  const configFiles = await globby(`*/${FUNCTION_CONFIG_FILE}`, {
    cwd: functionsDir,
    absolute: true,
  });

  const functions = await Promise.all(
    configFiles.map((configPath) => readFunction(configPath))
  );

  const names = new Set<string>();
  for (const fn of functions) {
    if (names.has(fn.name)) {
      throw new Error(`Duplicate function name "${fn.name}"`);
    }
    names.add(fn.name);
  }

  return functions;
}

