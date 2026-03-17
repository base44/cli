import { dirname, join } from "node:path";
import { log } from "@clack/prompts";
import type { Command } from "commander";
import type { RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask } from "@/cli/utils/index.js";
import { readProjectConfig } from "@/core/index.js";
import { listDeployedFunctions } from "@/core/resources/function/api.js";
import { writeFunctions } from "@/core/resources/function/pull.js";

async function pullFunctionsAction(
  name: string | undefined,
): Promise<RunCommandResult> {
  const { project } = await readProjectConfig();

  const configDir = dirname(project.configPath);
  const functionsDir = join(configDir, project.functionsDir);

  const remoteFunctions = await runTask(
    "Fetching functions from Base44",
    async () => {
      const { functions } = await listDeployedFunctions();
      return functions;
    },
    {
      successMessage: "Functions fetched successfully",
      errorMessage: "Failed to fetch functions",
    },
  );

  const toPull = name
    ? remoteFunctions.filter((f) => f.name === name)
    : remoteFunctions;

  if (name && toPull.length === 0) {
    return {
      outroMessage: `Function "${name}" not found on remote`,
    };
  }

  if (toPull.length === 0) {
    return { outroMessage: "No functions found on remote" };
  }

  const { written, skipped } = await runTask(
    "Writing function files",
    async () => {
      return await writeFunctions(functionsDir, toPull);
    },
    {
      successMessage: "Function files written successfully",
      errorMessage: "Failed to write function files",
    },
  );

  for (const name of written) {
    log.success(`${name.padEnd(25)} written`);
  }
  for (const name of skipped) {
    log.info(`${name.padEnd(25)} unchanged`);
  }

  return {
    outroMessage: `Pulled ${toPull.length} function${toPull.length !== 1 ? "s" : ""} to ${functionsDir}`,
  };
}

export function getPullCommand(): Command {
  return new Base44Command("pull")
    .description("Pull deployed functions from Base44")
    .argument("[name]", "Function name to pull (pulls all if omitted)")
    .action(pullFunctionsAction);
}
