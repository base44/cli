import { basename, dirname, join, relative } from "node:path";
import { globby } from "globby";
import { FUNCTION_CONFIG_FILE } from "@/core/consts.js";
import { InvalidInputError, SchemaValidationError } from "@/core/errors.js";
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

  const functionData: BackendFunction = { ...config, entryPath, filePaths };
  return functionData;
}

export async function readAllFunctions(
  functionsDir: string,
): Promise<BackendFunction[]> {
  if (!(await pathExists(functionsDir))) {
    return [];
  }

  const configFiles = await globby(`**/${FUNCTION_CONFIG_FILE}`, {
    cwd: functionsDir,
    absolute: true,
  });

  const entryFiles = await globby(`**/entry.{js,ts}`, {
    cwd: functionsDir,
    absolute: true,
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
          "entry.js/entry.ts must be inside a subfolder of the functions directory",
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

      return { name, entry, entryPath: entryFile, filePaths };
    }),
  );

  const functions = [...functionsFromConfig, ...functionsWithoutConfig];

  const names = new Set<string>();
  for (const fn of functions) {
    if (names.has(fn.name)) {
      throw new Error(`Duplicate function name "${fn.name}"`);
    }
    names.add(fn.name);
  }

  return functions;
}
