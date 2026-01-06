import { join } from 'path';
import { readdir, stat } from 'fs/promises';
import { FunctionConfigSchema, type FunctionConfig } from '../schemas/function.js';
import { FUNCTION_CONFIG_FILE } from './constants.js';
import { readJsonFile, fileExists } from '../utils/fs.js';

export async function readFunctionConfig(
  functionDir: string
): Promise<FunctionConfig> {
  const configPath = join(functionDir, FUNCTION_CONFIG_FILE);

  if (!fileExists(configPath)) {
    throw new Error(
      `Function configuration file not found: ${configPath}. Please ensure ${FUNCTION_CONFIG_FILE} exists in the function directory.`
    );
  }

  try {
    const parsed = await readJsonFile(configPath);
    const result = FunctionConfigSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(
        `Invalid function configuration in ${configPath}: ${result.error.issues
          .map((e) => e.message)
          .join(', ')}`
      );
    }

    return result.data;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid function')) {
      throw error;
    }
    if (error instanceof Error && error.message.includes('File not found')) {
      throw error;
    }
    throw new Error(
      `Failed to read function configuration ${configPath}: ${
        error instanceof Error ? error.message : 'Unknown error'
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

  try {
    const entries = await readdir(functionsDir);
    const functionConfigs: FunctionConfig[] = [];
    const errors: string[] = [];

    for (const entry of entries) {
      const entryPath = join(functionsDir, entry);
      try {
        const stats = await stat(entryPath);
        if (stats.isDirectory()) {
          const functionConfig = await readFunctionConfig(entryPath);
          functionConfigs.push(functionConfig);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${entry}: ${errorMessage}`);
      }
    }

    if (errors.length > 0 && functionConfigs.length === 0) {
      throw new Error(
        `Failed to read any function configurations:\n${errors.join('\n')}`
      );
    }

    if (errors.length > 0) {
      console.warn(
        `Warning: Some function directories could not be read:\n${errors.join('\n')}`
      );
    }

    return functionConfigs;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Failed to read')) {
      throw error;
    }
    throw new Error(
      `Failed to read functions directory ${functionsDir}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

