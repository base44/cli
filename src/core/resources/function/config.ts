import { globby } from "globby";
import { FUNCTION_CONFIG_FILE } from "../../config.js";
import { readJsonFile, pathExists } from "../../utils/fs.js";
import { FunctionConfigSchema } from "./schema.js";
import type { FunctionConfig } from "./schema.js";

export async function readFunctionConfig(
  configPath: string
): Promise<FunctionConfig> {
  const parsed = await readJsonFile(configPath);
  const result = FunctionConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Invalid function configuration in ${configPath}: ${result.error.issues
        .map((e) => e.message)
        .join(", ")}`
    );
  }

  return result.data;
}

export async function readAllFunctions(
  functionsDir: string
): Promise<FunctionConfig[]> {
  if (!(await pathExists(functionsDir))) {
    return [];
  }

  const configFiles = await globby(`*/${FUNCTION_CONFIG_FILE}`, {
    cwd: functionsDir,
    absolute: true,
  });

  const functionConfigs = await Promise.all(
    configFiles.map((configPath) => readFunctionConfig(configPath))
  );

  return functionConfigs;
}

