import { basename, dirname, join, relative } from "node:path";
import { globby } from "globby";
import {
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

async function readFunction(configPath: string): Promise<BackendFunction> {
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

  const filePaths = await globby("**/*.{js,ts,json}", {
    cwd: functionDir,
    absolute: true,
  });

  const functionData: BackendFunction = {
    ...config,
    entryPath,
    filePaths,
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

  const functionsFromConfig = await Promise.all(
    configFiles.map((configPath) => readFunction(configPath)),
  );

  const functionsWithoutConfig = await Promise.all(
    entryFilesWithoutConfig.map(async (entryFile) => {
      const functionDir = dirname(entryFile);
      const filePaths = await globby("**/*.{js,ts,json}", {
        cwd: functionDir,
        absolute: true,
      });

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
        filePaths,
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
