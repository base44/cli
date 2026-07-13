import { dirname, join, resolve } from "node:path";
import { confirmDestructiveAction } from "@/cli/commands/dev/seed-shared.js";
import { InvalidInputError } from "@/core/errors.js";
import type { ProjectData } from "@/core/project/types.js";
import type { Entity } from "@/core/resources/entity/index.js";
import { normalizeSeedName } from "@/core/resources/seed/index.js";
import { pathExists, writeFile } from "@/core/utils/fs.js";

/** `TeamMember` → `team-member` (seed fixture file naming). */
export function kebabCaseEntityName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

/**
 * Resolve `--entity` names against the project's entities (normalized
 * comparison, so `--entity task` matches `Task`). No names = all entities.
 */
export function resolveRequestedEntities(
  available: Entity[],
  requested: string[] | undefined,
): Entity[] {
  if (!requested?.length) {
    return available;
  }
  return requested.map((name) => {
    const match = available.find(
      (entity) => normalizeSeedName(entity.name) === normalizeSeedName(name),
    );
    if (!match) {
      throw new InvalidInputError(
        `Unknown entity "${name}". Known entities: ${
          available.map((entity) => entity.name).join(", ") || "none"
        }`,
      );
    }
    return match;
  });
}

/** Default fixture output dir: `<configDir>/<seedDir>`, or `--out`. */
export function resolveOutDir(
  project: ProjectData["project"],
  out: string | undefined,
): string {
  return out
    ? resolve(out)
    : join(dirname(project.configPath), project.seedDir);
}

export interface FixtureEntry {
  entityName: string;
  records: unknown[];
}

/**
 * Write one `<kebab-case entity>.jsonc` per entry (pretty JSON array).
 * Existing files require `--force` (or one TTY confirm covering all).
 */
export async function writeFixtureFiles(options: {
  outDir: string;
  entries: FixtureEntry[];
  force: boolean;
  isNonInteractive: boolean;
}): Promise<string[]> {
  const targets = options.entries.map((entry) => ({
    ...entry,
    path: join(
      options.outDir,
      `${kebabCaseEntityName(entry.entityName)}.jsonc`,
    ),
  }));

  const existing: string[] = [];
  for (const target of targets) {
    if (await pathExists(target.path)) {
      existing.push(target.path);
    }
  }
  if (existing.length > 0) {
    await confirmDestructiveAction(
      options.isNonInteractive,
      options.force,
      `Overwrite ${existing.length} existing fixture file(s) in ${options.outDir}?`,
      "--force is required to overwrite existing fixture files in non-interactive mode",
    );
  }

  for (const target of targets) {
    await writeFile(
      target.path,
      `${JSON.stringify(target.records, null, 2)}\n`,
    );
  }
  return targets.map((target) => target.path);
}

export interface DataResultEntry {
  entityName: string;
  pulled: number;
  total: number;
}

/** `--json` stdout shape shared by `data pull` and `data dump`. */
export function buildDataJsonOutput(
  entries: DataResultEntry[],
  wrote: string[],
): string {
  const entities: Record<string, { pulled: number; total: number }> = {};
  for (const entry of entries) {
    entities[entry.entityName] = { pulled: entry.pulled, total: entry.total };
  }
  return `${JSON.stringify({ entities, wrote }, null, 2)}\n`;
}
