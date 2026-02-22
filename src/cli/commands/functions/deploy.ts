import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { theme } from "@/cli/utils/theme.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/index.js";
import {
  pruneRemovedFunctions,
  pushFunctionsSingle,
} from "@/core/resources/function/deploy.js";
import type { SingleFunctionDeployResult } from "@/core/resources/function/deploy.js";

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatResult(r: SingleFunctionDeployResult): void {
  const label = r.name.padEnd(25);
  if (r.status === "deployed") {
    const timing = r.duration_ms ? theme.styles.dim(` (${formatDuration(r.duration_ms)})`) : "";
    log.success(`${label} deployed${timing}`);
  } else if (r.status === "unchanged") {
    log.success(`${label} unchanged`);
  } else {
    log.error(`${label} error: ${r.error}`);
  }
}

async function deployFunctionsAction(
  name: string | undefined,
  options: { prune?: boolean; concurrency?: number },
): Promise<RunCommandResult> {
  const { functions } = await readProjectConfig();

  const toDeploy = name
    ? functions.filter((f) => f.name === name)
    : functions;

  if (toDeploy.length === 0) {
    if (name) {
      throw new InvalidInputError(`Function "${name}" not found in project`);
    }
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
    concurrency: options.concurrency,
    onStart: (names) => {
      const label = names.length === 1 ? names[0] : `${names.length} functions`;
      log.step(theme.styles.dim(`[${completed}/${total}] Deploying ${label}...`));
    },
    onResult: (r) => {
      completed++;
      formatResult(r);
    },
  });

  const succeeded = results.filter((r) => r.status !== "error").length;
  const failed = results.filter((r) => r.status === "error").length;

  // Prune if requested
  if (options.prune) {
    log.info("Pruning remote functions not found locally...");
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
      log.info(`${pruned} function${pruned !== 1 ? "s" : ""} pruned`);
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
    .description("Deploy local functions to Base44")
    .argument("[name]", "Deploy a single function by name")
    .option("--prune", "Delete remote functions not found locally")
    .option(
      "-c, --concurrency <n>",
      "Number of functions to deploy in parallel",
    )
    .action(
      async (
        name: string | undefined,
        options: { prune?: boolean; concurrency?: string },
      ) => {
      await runCommand(
        () => {
          let concurrency: number | undefined;
          if (options.concurrency !== undefined) {
            const n = parseInt(options.concurrency, 10);
            if (Number.isNaN(n) || n < 1) {
              throw new InvalidInputError("--concurrency must be a positive integer");
            }
            concurrency = n;
          }
          return deployFunctionsAction(name, { prune: options.prune, concurrency });
        },
        { requireAuth: true },
        context,
      );
    });
}
