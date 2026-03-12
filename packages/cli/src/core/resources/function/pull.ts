import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { FunctionInfo } from "@/core/resources/function/schema.js";
import {
  pathExists,
  readJsonFile,
  readTextFile,
  writeFile,
  writeJsonFile,
} from "@/core/utils/fs.js";

interface WriteFunctionsResult {
  written: string[];
  skipped: string[];
}

/**
 * Writes remote function data to local function directories.
 * Creates function.jsonc config and all source files for each function.
 * Skips functions whose local files already match remote content.
 */
export async function writeFunctions(
  functionsDir: string,
  functions: FunctionInfo[],
): Promise<WriteFunctionsResult> {
  const written: string[] = [];
  const skipped: string[] = [];

  for (const fn of functions) {
    const functionDir = join(functionsDir, fn.name);
    const configPath = join(functionDir, "function.jsonc");

    // Check if all files already match remote content
    if (await isFunctionUnchanged(functionDir, fn)) {
      skipped.push(fn.name);
      continue;
    }

    // Write function config
    const config: Record<string, unknown> = {
      name: fn.name,
      entry: fn.entry,
    };
    if (fn.automations.length > 0) {
      config.automations = fn.automations;
    }
    await writeJsonFile(configPath, config);

    // Write all source files
    for (const file of fn.files) {
      await writeFile(join(functionDir, file.path), file.content);
    }

    written.push(fn.name);
  }

  return { written, skipped };
}

async function isFunctionUnchanged(
  functionDir: string,
  fn: FunctionInfo,
): Promise<boolean> {
  if (!(await pathExists(functionDir))) {
    return false;
  }

  // Compare function config (entry, automations)
  const configPath = join(functionDir, "function.jsonc");
  try {
    const localConfig = (await readJsonFile(configPath)) as Record<
      string,
      unknown
    >;
    if (localConfig.entry !== fn.entry) {
      return false;
    }
    if (!isDeepStrictEqual(localConfig.automations ?? [], fn.automations)) {
      return false;
    }
  } catch {
    return false;
  }

  // Compare source files
  for (const file of fn.files) {
    const filePath = join(functionDir, file.path);
    if (!(await pathExists(filePath))) {
      return false;
    }
    try {
      const localContent = await readTextFile(filePath);
      if (localContent !== file.content) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}
