import { log } from "@clack/prompts";
import type { Command } from "commander";
import { formatDeployResult } from "@/cli/commands/functions/formatDeployResult.js";
import { parseNames } from "@/cli/commands/functions/parseNames.js";
import type { RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/index.js";
import {
  deployFunctionsSequentially,
  type PruneResult,
  pruneRemovedFunctions,
  type SingleFunctionDeployResult,
} from "@/core/resources/function/deploy.js";
import type { BackendFunction } from "@/core/resources/function/schema.js";

function resolveFunctionsToDeploy(
  names: string[],
  allFunctions: BackendFunction[],
): BackendFunction[] {
  if (names.length === 0) return allFunctions;

  const notFound = names.filter((n) => !allFunctions.some((f) => f.name === n));
  if (notFound.length > 0) {
    throw new InvalidInputError(
      `Function${notFound.length > 1 ? "s" : ""} not found in project: ${notFound.join(", ")}`,
    );
  }
  return allFunctions.filter((f) => names.includes(f.name));
}

function formatPruneResult(pruneResult: PruneResult): void {
  if (pruneResult.deleted) {
    log.success(`${pruneResult.name.padEnd(25)} deleted`);
  } else {
    log.error(`${pruneResult.name.padEnd(25)} error: ${pruneResult.error}`);
  }
}

function formatPruneSummary(pruneResults: PruneResult[]): void {
  if (pruneResults.length > 0) {
    const pruned = pruneResults.filter((r) => r.deleted).length;
    log.info(`${pruned} deleted`);
  }
}

function buildDeploySummary(results: SingleFunctionDeployResult[]): string {
  const deployed = results.filter((r) => r.status === "deployed").length;
  const unchanged = results.filter((r) => r.status === "unchanged").length;
  const failed = results.filter((r) => r.status === "error").length;

  const parts: string[] = [];
  if (deployed > 0) parts.push(`${deployed} deployed`);
  if (unchanged > 0) parts.push(`${unchanged} unchanged`);
  if (failed > 0) parts.push(`${failed} error${failed !== 1 ? "s" : ""}`);
  return parts.join(", ") || "No functions deployed";
}

async function deployFunctionsAction(
  names: string[],
  options: { force?: boolean },
): Promise<RunCommandResult> {
  if (options.force && names.length > 0) {
    throw new InvalidInputError(
      "--force cannot be used when specifying function names",
    );
  }

  const { functions } = await readProjectConfig();
  const toDeploy = resolveFunctionsToDeploy(names, functions);

  if (toDeploy.length === 0) {
    return {
      outroMessage:
        "No functions found. Create functions in the 'functions' directory.",
    };
  }

  log.info(
    `Found ${toDeploy.length} ${toDeploy.length === 1 ? "function" : "functions"} to deploy`,
  );

  let completed = 0;
  const total = toDeploy.length;

  const results = await deployFunctionsSequentially(toDeploy, {
    onStart: (startNames) => {
      const label =
        startNames.length === 1
          ? startNames[0]
          : `${startNames.length} functions`;
      log.step(
        theme.styles.dim(`[${completed + 1}/${total}] Deploying ${label}...`),
      );
    },
    onResult: (result) => {
      completed++;
      formatDeployResult(result);
    },
  });

  if (options.force) {
    const allLocalNames = functions.map((f) => f.name);
    let pruneCompleted = 0;
    let pruneTotal = 0;
    const pruneResults = await pruneRemovedFunctions(allLocalNames, {
      onStart: (total) => {
        pruneTotal = total;
        if (total > 0) {
          log.info(
            `Found ${total} remote ${total === 1 ? "function" : "functions"} to delete`,
          );
        }
      },
      onBeforeDelete: (name) => {
        pruneCompleted++;
        log.step(
          theme.styles.dim(
            `[${pruneCompleted}/${pruneTotal}] Deleting ${name}...`,
          ),
        );
      },
      onResult: formatPruneResult,
    });
    formatPruneSummary(pruneResults);
  }

  return { outroMessage: buildDeploySummary(results) };
}

export function getDeployCommand(): Command {
  return new Base44Command("deploy")
    .description("Deploy functions to Base44")
    .argument("[names...]", "Function names to deploy (deploys all if omitted)")
    .option("--force", "Delete remote functions not found locally")
    .action(async (rawNames: string[], options: { force?: boolean }) => {
      const names = parseNames(rawNames);
      return deployFunctionsAction(names, options);
    });
}
