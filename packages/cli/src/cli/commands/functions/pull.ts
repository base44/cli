import { dirname, join } from "node:path";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { readProjectConfig } from "@/core/index.js";
import { listDeployedFunctions } from "@/core/resources/function/api.js";
import { writeFunctions } from "@/core/resources/function/pull.js";

async function pullFunctionsAction(
  { log, runTask }: CLIContext,
  name: string | undefined,
): Promise<RunCommandResult> {
  const { project, functions } = await readProjectConfig();

  const configDir = dirname(project.configPath);
  const functionsDir = join(configDir, project.functionsDir);
  const pluginFunctionNames = new Set(
    functions.filter((fn) => fn.source.type === "plugin").map((fn) => fn.name),
  );

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

  if (name && pluginFunctionNames.has(name)) {
    return {
      outroMessage: `Function "${name}" is managed by a plugin and was not pulled into ${functionsDir}`,
    };
  }

  const matchingRemote = name
    ? remoteFunctions.filter((f) => f.name === name)
    : remoteFunctions;

  if (name && matchingRemote.length === 0) {
    return {
      outroMessage: `Function "${name}" not found on remote`,
    };
  }

  const skippedPluginOwned = matchingRemote.filter((fn) =>
    pluginFunctionNames.has(fn.name),
  );
  const toPull = matchingRemote.filter(
    (fn) => !pluginFunctionNames.has(fn.name),
  );

  if (toPull.length === 0) {
    if (skippedPluginOwned.length > 0) {
      return {
        outroMessage: `Skipped ${skippedPluginOwned.length} plugin-owned function${skippedPluginOwned.length !== 1 ? "s" : ""}; no project-owned functions to pull`,
      };
    }
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
  for (const fn of skippedPluginOwned) {
    log.info(`${fn.name.padEnd(25)} plugin-owned, skipped`);
  }

  return {
    outroMessage: `Pulled ${toPull.length} function${toPull.length !== 1 ? "s" : ""} to ${functionsDir}${skippedPluginOwned.length > 0 ? `; skipped ${skippedPluginOwned.length} plugin-owned` : ""}`,
  };
}

export function getPullCommand(): Command {
  return new Base44Command("pull")
    .description("Pull deployed functions from Base44")
    .argument("[name]", "Function name to pull (pulls all if omitted)")
    .action(pullFunctionsAction);
}
