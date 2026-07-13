import { basename, dirname, join, relative, resolve } from "node:path";
import { globby } from "globby";
import {
  BACKEND_FILE_GLOB,
  ENTRY_FILE_GLOB,
  ENTRY_IGNORE_DOT_PATHS,
  FUNCTION_CONFIG_GLOB,
} from "@/core/consts.js";
import {
  ConfigInvalidError,
  InvalidInputError,
  SchemaValidationError,
} from "@/core/errors.js";
import type {
  BackendFunction,
  FunctionConfig,
} from "@/core/resources/function/schema.js";
import { FunctionConfigSchema } from "@/core/resources/function/schema.js";
import { pathExists, readJsonFile } from "@/core/utils/fs.js";

/**
 * Collect every file under `base44/shared/`. These are uploaded alongside each
 * function so shared modules imported via `../../shared/...` bundle server-side.
 * The bundler tree-shakes anything a given function doesn't import.
 */
async function readSharedFiles(functionsDir: string): Promise<string[]> {
  const sharedDir = resolve(functionsDir, "..", "shared");
  if (!(await pathExists(sharedDir))) {
    return [];
  }
  return globby(BACKEND_FILE_GLOB, { cwd: sharedDir, absolute: true });
}

async function readFunctionConfig(configPath: string): Promise<FunctionConfig> {
  const parsed = await readJsonFile(configPath);
  const result = FunctionConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid function configuration",
      result.error,
      configPath,
    );
  }

  return result.data;
}

async function readFunction(
  configPath: string,
  sharedFiles: string[],
): Promise<BackendFunction> {
  const config = await readFunctionConfig(configPath);
  const functionDir = dirname(configPath);
  const entryPath = join(functionDir, config.entry);

  if (!(await pathExists(entryPath))) {
    throw new InvalidInputError(
      `Function entry file not found: ${entryPath} (referenced in ${configPath})`,
      {
        hints: [{ message: "Check the 'entry' field in your function config" }],
      },
    );
  }

  const filePaths = await globby(BACKEND_FILE_GLOB, {
    cwd: functionDir,
    absolute: true,
  });

  const allFilePaths = [...new Set([...filePaths, ...sharedFiles])];

  const functionData: BackendFunction = {
    ...config,
    entryPath,
    filePaths: allFilePaths,
    source: { type: "project" },
  };
  return functionData;
}

export async function readAllFunctions(
  functionsDir: string,
): Promise<BackendFunction[]> {
  if (!(await pathExists(functionsDir))) {
    return [];
  }

  const configFiles = await globby(FUNCTION_CONFIG_GLOB, {
    cwd: functionsDir,
    absolute: true,
  });

  const entryFiles = await globby(ENTRY_FILE_GLOB, {
    cwd: functionsDir,
    absolute: true,
    ignore: ENTRY_IGNORE_DOT_PATHS,
  });

  const configFilesDirs = new Set(configFiles.map((f) => dirname(f)));

  const entryFilesWithoutConfig = entryFiles.filter(
    (entryFile) => !configFilesDirs.has(dirname(entryFile)),
  );

  const sharedFiles = await readSharedFiles(functionsDir);

  const functionsFromConfig = await Promise.all(
    configFiles.map((configPath) => readFunction(configPath, sharedFiles)),
  );

  const functionsWithoutConfig = await Promise.all(
    entryFilesWithoutConfig.map(async (entryFile) => {
      const functionDir = dirname(entryFile);
      const filePaths = await globby(BACKEND_FILE_GLOB, {
        cwd: functionDir,
        absolute: true,
      });

      const allFilePaths = [...new Set([...filePaths, ...sharedFiles])];

      const name = relative(functionsDir, functionDir).split(/[/\\]/).join("/");
      if (!name) {
        throw new InvalidInputError(
          "entry.ts found directly in the functions directory — it must be inside a named subfolder",
          {
            hints: [
              {
                message: `Move ${entryFile} into a subfolder (e.g. functions/myFunc/entry.ts)`,
              },
            ],
          },
        );
      }
      const entry = basename(entryFile);

      const functionData: BackendFunction = {
        name,
        entry,
        entryPath: entryFile,
        filePaths: allFilePaths,
        source: { type: "project" },
      };
      return functionData;
    }),
  );

  const functions = [...functionsFromConfig, ...functionsWithoutConfig];

  const names = new Set<string>();
  for (const fn of functions) {
    if (names.has(fn.name)) {
      throw new ConfigInvalidError(
        `Duplicate function name "${fn.name}" in ${functionsDir}`,
        functionsDir,
        {
          hints: [
            {
              message:
                "Ensure each function has a unique name (or path for zero-config functions).",
            },
          ],
        },
      );
    }
    names.add(fn.name);
  }

  return functions;
}
