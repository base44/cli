import { dirname, join, basename } from "node:path";
import { globby } from "globby";
import kebabCase from "lodash.kebabcase";
import { FUNCTION_CONFIG_FILE } from "@/core/consts.js";
import { readJsonFile, pathExists } from "@/core/utils/fs.js";
import { FunctionConfigSchema, FunctionSchema } from "@/core/resources/function/schema.js";
import type { FunctionConfig, Function } from "@/core/resources/function/schema.js";

export async function readFunctionConfig(
  configPath: string
): Promise<FunctionConfig> {
  const parsed = await readJsonFile(configPath);
  const result = FunctionConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Invalid function configuration in ${configPath}: ${result.error.message}`
    );
  }

  return result.data;
}

export async function readFunction(configPath: string): Promise<Function> {
  const config = await readFunctionConfig(configPath);
  const functionDir = dirname(configPath);
  const codePath = join(functionDir, config.entry);

  if (!(await pathExists(codePath))) {
    throw new Error(
      `Function code file not found: ${codePath} (referenced in ${configPath})`
    );
  }

  const functionData = { ...config, codePath };
  const result = FunctionSchema.safeParse(functionData);
  if (!result.success) {
    throw new Error(
      `Invalid function in ${configPath}: ${result.error.message}`
    );
  }

  return result.data;
}

/**
 * Creates a function from a directory without a config file.
 * Looks for index.ts and uses the folder name as the function name.
 */
export async function readFunctionFromDirectory(
  functionDir: string
): Promise<Function | null> {
  const indexPath = join(functionDir, "index.ts");

  if (!(await pathExists(indexPath))) {
    return null;
  }

  const folderName = basename(functionDir);
  const functionName = kebabCase(folderName);

  const functionData = {
    name: functionName,
    entry: "index.ts",
    codePath: indexPath,
  };

  const result = FunctionSchema.safeParse(functionData);
  if (!result.success) {
    throw new Error(
      `Invalid auto-detected function in ${functionDir}: ${result.error.message}`
    );
  }

  return result.data;
}

export async function readAllFunctions(
  functionsDir: string
): Promise<Function[]> {
  if (!(await pathExists(functionsDir))) {
    return [];
  }

  // Read functions with config files
  const configFiles = await globby(`*/${FUNCTION_CONFIG_FILE}`, {
    cwd: functionsDir,
    absolute: true,
  });

  const functionsWithConfig = await Promise.all(
    configFiles.map((configPath) => readFunction(configPath))
  );

  // Find all directories that don't have config files
  const allDirs = await globby("*/", {
    cwd: functionsDir,
    absolute: true,
    onlyDirectories: true,
  });

  const dirsWithConfig = new Set(
    configFiles.map((configPath) => dirname(configPath))
  );

  const dirsWithoutConfig = allDirs.filter((dir) => !dirsWithConfig.has(dir));

  // Try to read functions from directories without config files
  const autoDetectedFunctions = (
    await Promise.all(
      dirsWithoutConfig.map((dir) => readFunctionFromDirectory(dir))
    )
  ).filter((fn): fn is Function => fn !== null);

  // Combine both types of functions
  const functions = [...functionsWithConfig, ...autoDetectedFunctions];

  // Check for duplicate names
  const names = new Set<string>();
  for (const fn of functions) {
    if (names.has(fn.name)) {
      throw new Error(`Duplicate function name "${fn.name}"`);
    }
    names.add(fn.name);
  }

  return functions;
}

