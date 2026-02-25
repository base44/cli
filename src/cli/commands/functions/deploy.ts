import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { formatDeployResult } from "@/cli/utils/formatDeployResult.js";
import { runCommand } from "@/cli/utils/index.js";
import { parseNames } from "@/cli/utils/parseNames.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { theme } from "@/cli/utils/theme.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/index.js";
import {
  pruneRemovedFunctions,
  pushFunctionsSingle,
} from "@/core/resources/function/deploy.js";

async function deployFunctionsAction(
  names: string[],
  options: { force?: boolean },
): Promise<RunCommandResult> {
  if (options.force && names.length > 0) {
    throw new InvalidInputError("--force cannot be used when specifying function names");
  }

  const { functions } = await readProjectConfig();

  let toDeploy;
  if (names.length > 0) {
    const notFound = names.filter((n) => !functions.some((f) => f.name === n));
    if (notFound.length > 0) {
      throw new InvalidInputError(
        `Function${notFound.length > 1 ? "s" : ""} not found in project: ${notFound.join(", ")}`,
      );
    }
    toDeploy = functions.filter((f) => names.includes(f.name));
  } else {
    toDeploy = functions;
  }

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

  const results = await pushFunctionsSingle(toDeploy, {
    onStart: (startNames) => {
      const label = startNames.length === 1 ? startNames[0] : `${startNames.length} functions`;
      log.step(theme.styles.dim(`[${completed}/${total}] Deploying ${label}...`));
    },
    onResult: (r) => {
      completed++;
      formatDeployResult(r);
    },
  });

  const succeeded = results.filter((r) => r.status !== "error").length;
  const failed = results.filter((r) => r.status === "error").length;

  // Force: delete remote functions not found locally
  if (options.force) {
    log.info("Removing remote functions not found locally...");
    const allLocalNames = functions.map((f) => f.name);
    const pruneResults = await pruneRemovedFunctions(allLocalNames);

    for (const pr of pruneResults) {
      if (pr.deleted) {
        log.success(`${pr.name.padEnd(25)} deleted`);
      } else {
        log.error(`${pr.name.padEnd(25)} error: ${pr.error}`);
      }
    }

    if (pruneResults.length > 0) {
      const pruned = pruneResults.filter((r) => r.deleted).length;
      log.info(`${pruned} function${pruned !== 1 ? "s" : ""} removed`);
    }
  }

  // Summary
  const parts: string[] = [];
  if (succeeded > 0) parts.push(`${succeeded}/${results.length} succeeded`);
  if (failed > 0) parts.push(`${failed} error${failed !== 1 ? "s" : ""}`);
  const summary = parts.join(", ") || "No functions deployed";

  return { outroMessage: summary };
}

export function getDeployCommand(context: CLIContext): Command {
  return new Command("deploy")
    .description("Deploy functions to Base44")
    .argument("[names...]", "Function names to deploy (deploys all if omitted)")
    .option("--force", "Delete remote functions not found locally")
    .action(
      async (
        rawNames: string[],
        options: { force?: boolean },
      ) => {
      await runCommand(
        () => {
          const names = parseNames(rawNames);
          return deployFunctionsAction(names, options);
        },
        { requireAuth: true },
        context,
      );
    });
}
