import { globby } from "globby";
import {
  FunctionConfigSchema,
  type FunctionConfig,
} from "../schemas/function.js";
import { FUNCTION_CONFIG_FILE } from "./constants.js";
import { readJsonFile, fileExists } from "../utils/fs.js";

export async function readFunctionConfig(
  configPath: string
): Promise<FunctionConfig> {
  if (!fileExists(configPath)) {
    throw new Error(`Function configuration file not found: ${configPath}`);
  }

  try {
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
  } catch (error) {
    throw new Error(
      `Failed to read function configuration ${configPath}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

export async function readAllFunctions(
  functionsDir: string
): Promise<FunctionConfig[]> {
  if (!fileExists(functionsDir)) {
    throw new Error(`Functions directory not found: ${functionsDir}`);
  }

  const configFiles = await globby(`*/${FUNCTION_CONFIG_FILE}`, {
    cwd: functionsDir,
    absolute: true,
  });

  const functionConfigs: FunctionConfig[] = [];

  for (const configPath of configFiles) {
    const config = await readFunctionConfig(configPath);
    functionConfigs.push(config);
  }

  return functionConfigs;
}
