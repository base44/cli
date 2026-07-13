import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { readDevInstance } from "@/core/local-state/index.js";
import {
  confirmDestructiveAction,
  logSeedSummary,
  requireDevProject,
  resetOffline,
  resetViaInstance,
} from "./seed-shared.js";

interface DevResetOptions {
  force?: boolean;
}

async function devResetAction(
  ctx: CLIContext,
  options: DevResetOptions,
): Promise<RunCommandResult> {
  const { log, app, jsonMode, isNonInteractive } = ctx;
  const project = requireDevProject(app, "dev reset");

  await confirmDestructiveAction(
    isNonInteractive,
    options.force === true,
    "This deletes ALL local dev data and re-applies seeds. Continue?",
    "--force is required to reset in non-interactive mode",
  );

  const instance = await readDevInstance(project.projectRoot);
  const result = instance
    ? await resetViaInstance(instance)
    : await resetOffline(project, log);

  // Reset + fixtures succeeded but seed.ts failed: report, exit non-zero.
  if (result.seed?.script?.ran === false) {
    process.exitCode = 1;
  }

  const outroMessage = result.seeded
    ? "Local data reset and seeds applied"
    : "Local data reset";

  if (jsonMode) {
    return {
      outroMessage,
      stdout: `${JSON.stringify(result, null, 2)}\n`,
    };
  }

  if (result.seed) {
    logSeedSummary(log, result.seed);
  }
  return { outroMessage };
}

export function getDevResetCommand(): Command {
  return new Base44Command("reset")
    .description("Wipe the local dev database and re-apply seeds")
    .option("--force", "Skip the confirmation prompt")
    .action(devResetAction);
}
