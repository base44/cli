import type { Command } from "commander";
import {
  buildDataJsonOutput,
  type DataResultEntry,
  resolveOutDir,
  resolveRequestedEntities,
  writeFixtureFiles,
} from "@/cli/commands/data/shared.js";
import {
  exportViaInstance,
  openOfflineDatabase,
  requireDevProject,
} from "@/cli/commands/dev/seed-shared.js";
import { exportCollections } from "@/cli/dev/dev-server/db/export.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { readDevInstance } from "@/core/local-state/index.js";
import { readProjectConfig } from "@/core/project/config.js";
import { normalizeSeedName } from "@/core/resources/seed/index.js";

interface DataDumpOptions {
  entity?: string[];
  out?: string;
  force?: boolean;
}

const USER_SKIPPED_WARNING =
  "User records are not dumped — user fixtures are users.jsonc-shaped; skipping User";

async function dataDumpAction(
  ctx: CLIContext,
  options: DataDumpOptions,
): Promise<RunCommandResult> {
  const { log, app, jsonMode, isNonInteractive } = ctx;
  const project = requireDevProject(app, "data dump");
  const projectData = await readProjectConfig(project.projectRoot);

  // User dumps are out of scope (v1): user fixtures carry passwords/roles in
  // users.jsonc shape, not entity-fixture shape.
  const warnings: string[] = [];
  const explicit = (options.entity?.length ?? 0) > 0;
  let requested: string[] | undefined;
  if (explicit) {
    const kept = (options.entity ?? []).filter(
      (name) => normalizeSeedName(name) !== "user",
    );
    if (kept.length < (options.entity?.length ?? 0)) {
      warnings.push(USER_SKIPPED_WARNING);
    }
    // Validates names and canonicalizes them to entity display names.
    requested =
      kept.length > 0
        ? resolveRequestedEntities(
            projectData.entities.filter(
              (entity) => normalizeSeedName(entity.name) !== "user",
            ),
            kept,
          ).map((entity) => entity.name)
        : [];
  }

  const instance = await readDevInstance(project.projectRoot);
  let collections: Record<string, Record<string, unknown>[]> = {};
  if (!explicit || (requested?.length ?? 0) > 0) {
    if (instance) {
      collections = (await exportViaInstance(instance, requested)).collections;
    } else {
      const { db } = await openOfflineDatabase(project, projectData);
      collections = await exportCollections(db, requested);
    }
  }

  // Skip empty collections unless the entity was explicitly requested.
  const results: (DataResultEntry & { records: unknown[] })[] = Object.entries(
    collections,
  )
    .filter(([, records]) => explicit || records.length > 0)
    .map(([entityName, records]) => ({
      entityName,
      records,
      pulled: records.length,
      total: records.length,
    }));

  const outDir = resolveOutDir(projectData.project, options.out);
  const wrote = await writeFixtureFiles({
    outDir,
    entries: results,
    force: options.force === true,
    isNonInteractive,
  });

  for (const warning of warnings) {
    log.warn(warning);
  }

  const outroMessage = `Wrote ${wrote.length} fixture file(s) to ${outDir}`;

  if (jsonMode) {
    return { outroMessage, stdout: buildDataJsonOutput(results, wrote) };
  }

  if (results.length > 0) {
    log.info(
      results
        .map(
          (result) =>
            `${result.entityName}: pulled ${result.pulled} of ${result.total}`,
        )
        .join("\n"),
    );
  }
  return { outroMessage };
}

export function getDataDumpCommand(): Command {
  return new Base44Command("dump")
    .description("Dump local dev data into seed fixtures")
    .option(
      "--entity <names...>",
      "Only dump these entities (default: all non-empty collections)",
    )
    .option(
      "--out <dir>",
      "Output directory (default: the project's seed directory)",
    )
    .option("--force", "Overwrite existing fixture files without confirming")
    .action(dataDumpAction);
}
