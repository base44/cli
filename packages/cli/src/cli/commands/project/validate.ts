import { dirname, join, relative } from "node:path";
import { log } from "@clack/prompts";
import { Command } from "commander";
import { globby } from "globby";
import { z } from "zod";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import {
  CONFIG_FILE_EXTENSION_GLOB,
  FUNCTION_CONFIG_GLOB,
} from "@/core/consts.js";
import {
  ConfigNotFoundError,
  findProjectRoot,
  ProjectConfigSchema,
  pathExists,
  readJsonFile,
} from "@/core/index.js";
import { AgentConfigSchema } from "@/core/resources/agent/schema.js";
import { ConnectorResourceSchema } from "@/core/resources/connector/schema.js";
import { EntitySchema } from "@/core/resources/entity/schema.js";
import { FunctionConfigSchema } from "@/core/resources/function/schema.js";

interface FileResult {
  relativePath: string;
  valid: boolean;
  errorText?: string;
}

async function validateFiles(
  dir: string,
  glob: string,
  schema: z.ZodType,
  projectRoot: string,
): Promise<FileResult[]> {
  if (!(await pathExists(dir))) {
    return [];
  }

  const files = await globby(glob, { cwd: dir, absolute: true });
  const results: FileResult[] = [];

  for (const filePath of files) {
    const relativePath = relative(projectRoot, filePath);
    try {
      const parsed = await readJsonFile(filePath);
      const result = schema.safeParse(parsed);
      if (result.success) {
        results.push({ relativePath, valid: true });
      } else {
        results.push({
          relativePath,
          valid: false,
          errorText: z.prettifyError(result.error),
        });
      }
    } catch (error) {
      results.push({
        relativePath,
        valid: false,
        errorText: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

function printResults(results: FileResult[]): void {
  for (const result of results) {
    if (result.valid) {
      log.success(result.relativePath);
    } else {
      const indented = result.errorText
        ?.split("\n")
        .map((line) => `  ${line}`)
        .join("\n");
      log.error(`${result.relativePath}\n${indented ?? ""}`);
    }
  }
}

async function validateAction(): Promise<RunCommandResult> {
  const found = await findProjectRoot();
  if (!found) {
    throw new ConfigNotFoundError();
  }

  const { root, configPath } = found;
  const relConfigPath = relative(root, configPath);
  const allResults: FileResult[] = [];

  // Validate project config first — we need it to know resource dirs
  const configParsed = await readJsonFile(configPath);
  const configResult = ProjectConfigSchema.safeParse(configParsed);

  if (!configResult.success) {
    allResults.push({
      relativePath: relConfigPath,
      valid: false,
      errorText: z.prettifyError(configResult.error),
    });
    printResults(allResults);
    process.exitCode = 1;
    return { outroMessage: "1 file checked — 0 passed, 1 failed" };
  }

  allResults.push({ relativePath: relConfigPath, valid: true });

  const config = configResult.data;
  const configDir = dirname(configPath);

  // Validate all resource types in parallel
  const [entityResults, agentResults, connectorResults, functionResults] =
    await Promise.all([
      validateFiles(
        join(configDir, config.entitiesDir),
        `*.${CONFIG_FILE_EXTENSION_GLOB}`,
        EntitySchema,
        root,
      ),
      validateFiles(
        join(configDir, config.agentsDir),
        `*.${CONFIG_FILE_EXTENSION_GLOB}`,
        AgentConfigSchema,
        root,
      ),
      validateFiles(
        join(configDir, config.connectorsDir),
        `*.${CONFIG_FILE_EXTENSION_GLOB}`,
        ConnectorResourceSchema,
        root,
      ),
      validateFiles(
        join(configDir, config.functionsDir),
        FUNCTION_CONFIG_GLOB,
        FunctionConfigSchema,
        root,
      ),
    ]);

  allResults.push(
    ...entityResults,
    ...agentResults,
    ...connectorResults,
    ...functionResults,
  );

  printResults(allResults);

  const failCount = allResults.filter((r) => !r.valid).length;
  const passCount = allResults.length - failCount;
  const total = allResults.length;

  if (failCount > 0) {
    process.exitCode = 1;
  }

  return {
    outroMessage:
      failCount > 0
        ? `${total} file${total !== 1 ? "s" : ""} checked — ${passCount} passed, ${failCount} failed`
        : `All ${passCount} file${passCount !== 1 ? "s" : ""} valid`,
  };
}

export function getValidateCommand(context: CLIContext): Command {
  return new Command("validate")
    .description(
      "Validate all resource config files in the project (entities, functions, agents, connectors)",
    )
    .action(async () => {
      await runCommand(
        validateAction,
        { requireAuth: false, requireAppConfig: false },
        context,
      );
    });
}
