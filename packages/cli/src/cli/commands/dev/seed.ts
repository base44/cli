import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { readDevInstance } from "@/core/local-state/index.js";
import type { SeedMode } from "@/core/resources/seed/index.js";
import {
  confirmDestructiveAction,
  logSeedSummary,
  requireDevProject,
  seedOffline,
  seedViaInstance,
} from "./seed-shared.js";

interface DevSeedOptions {
  replace?: boolean;
  force?: boolean;
}

async function devSeedAction(
  ctx: CLIContext,
  options: DevSeedOptions,
): Promise<RunCommandResult> {
  const { log, app, jsonMode, isNonInteractive } = ctx;
  const project = requireDevProject(app, "dev seed");

  const mode: SeedMode = options.replace ? "replace" : "upsert";
  if (mode === "replace") {
    await confirmDestructiveAction(
      isNonInteractive,
      options.force === true,
      "Replace mode deletes existing records in seeded collections. Continue?",
      "--force is required to use --replace in non-interactive mode",
    );
  }

  const instance = await readDevInstance(project.projectRoot);
  const summary = instance
    ? await seedViaInstance(instance, mode)
    : await seedOffline(project, mode);

  const outroMessage = summary.applied
    ? `Seeds applied (${summary.mode} mode)`
    : "No seed files found — nothing applied";

  if (jsonMode) {
    return {
      outroMessage,
      stdout: `${JSON.stringify(summary, null, 2)}\n`,
    };
  }

  logSeedSummary(log, summary);
  return { outroMessage };
}

export function getDevSeedCommand(): Command {
  return new Base44Command("seed")
    .description("Apply seed fixtures to the local dev database")
    .option(
      "--replace",
      "Delete existing records in seeded collections before inserting",
    )
    .option("--force", "Skip the confirmation prompt for --replace")
    .action(devSeedAction);
}
