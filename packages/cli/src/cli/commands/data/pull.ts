import type { Command } from "commander";
import { Option } from "commander";
import {
  buildDataJsonOutput,
  type DataResultEntry,
  resolveOutDir,
  resolveRequestedEntities,
  writeFixtureFiles,
} from "@/cli/commands/data/shared.js";
import { requireDevProject } from "@/cli/commands/dev/seed-shared.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/config.js";
import {
  type DataEnv,
  fetchEntityRecords,
} from "@/core/resources/entity/index.js";

const DEFAULT_LIMIT = 1000;

interface DataPullOptions {
  entity?: string[];
  dataEnv: DataEnv;
  query?: string;
  limit?: string;
  out?: string;
  force?: boolean;
}

function parseQueryOption(
  query: string | undefined,
): Record<string, unknown> | undefined {
  if (query === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(query);
  } catch {
    throw new InvalidInputError("--query must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InvalidInputError(
      '--query must be a JSON object, e.g. \'{"status": "open"}\'',
    );
  }
  return parsed as Record<string, unknown>;
}

function parseLimitOption(limit: string | undefined): number {
  if (limit === undefined) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(limit, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new InvalidInputError("--limit must be a positive integer");
  }
  return parsed;
}

async function dataPullAction(
  ctx: CLIContext,
  options: DataPullOptions,
): Promise<RunCommandResult> {
  const { log, app, jsonMode, isNonInteractive } = ctx;
  const project = requireDevProject(app, "data pull");

  const query = parseQueryOption(options.query);
  const limit = parseLimitOption(options.limit);

  const projectData = await readProjectConfig(project.projectRoot);
  const entities = resolveRequestedEntities(
    projectData.entities,
    options.entity,
  );

  const results: (DataResultEntry & {
    records: unknown[];
    limitReached: boolean;
  })[] = [];
  for (const entity of entities) {
    const { records, limitReached } = await fetchEntityRecords(entity.name, {
      dataEnv: options.dataEnv,
      query,
      limit,
    });
    results.push({
      entityName: entity.name,
      records,
      limitReached,
      pulled: records.length,
      total: records.length,
    });
  }

  const outDir = resolveOutDir(projectData.project, options.out);
  const wrote = await writeFixtureFiles({
    outDir,
    entries: results,
    force: options.force === true,
    isNonInteractive,
  });

  const outroMessage = `Wrote ${wrote.length} fixture file(s) to ${outDir}`;

  if (jsonMode) {
    return { outroMessage, stdout: buildDataJsonOutput(results, wrote) };
  }

  log.info(
    results
      .map(
        (result) =>
          `${result.entityName}: pulled ${result.pulled} of ${result.total}${
            result.limitReached ? " (limit reached, more may exist)" : ""
          }`,
      )
      .join("\n"),
  );
  return { outroMessage };
}

export function getDataPullCommand(): Command {
  return new Base44Command("pull")
    .description(
      "Pull entity records from the linked remote app into seed fixtures",
    )
    .option(
      "--entity <names...>",
      "Only pull these entities (default: all project entities)",
    )
    .addOption(
      new Option("--data-env <env>", "Remote data environment to read from")
        .choices(["prod", "dev"])
        .default("prod"),
    )
    .option("--query <json>", "Filter records with a JSON query")
    .option(
      "--limit <n>",
      `Maximum records to pull per entity (default: ${DEFAULT_LIMIT})`,
    )
    .option(
      "--out <dir>",
      "Output directory (default: the project's seed directory)",
    )
    .option("--force", "Overwrite existing fixture files without confirming")
    .action(dataPullAction);
}
