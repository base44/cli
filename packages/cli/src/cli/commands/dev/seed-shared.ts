import type { Logger } from "@base44-cli/logger";
import { cancel, confirm, isCancel } from "@clack/prompts";
import type { z } from "zod";
import { Database } from "@/cli/dev/dev-server/db/database.js";
import { applySeeds } from "@/cli/dev/dev-server/db/seed.js";
import {
  DEV_ADMIN_BASE_PATH,
  DEV_ADMIN_HEADER,
} from "@/cli/dev/dev-server/routes/admin-router.js";
import { formatSeedCounts } from "@/cli/dev/seed-summary.js";
import { CLIExitError } from "@/cli/errors.js";
import {
  ApiError,
  ConfigInvalidError,
  InvalidInputError,
  SchemaValidationError,
} from "@/core/errors.js";
import {
  type DevInstance,
  getDataDir,
  getMetaJsonPath,
  readDataDirMeta,
  writeDataDirMeta,
} from "@/core/local-state/index.js";
import type { AppContext } from "@/core/project/app-config.js";
import { readProjectConfig } from "@/core/project/config.js";
import type { ProjectData } from "@/core/project/types.js";
import {
  type DevResetResult,
  DevResetResultSchema,
  emptySeedSummary,
  readSeedFiles,
  type SeedMode,
  type SeedSummary,
  SeedSummarySchema,
} from "@/core/resources/seed/index.js";

export interface DevProjectContext {
  id: string;
  projectRoot: string;
}

export function requireDevProject(
  app: AppContext | undefined,
  commandName: string,
): DevProjectContext {
  if (!app?.projectRoot) {
    throw new ConfigInvalidError(
      `base44 ${commandName} requires a linked local project. Run it from a project with base44/.app.jsonc.`,
    );
  }
  return { id: app.id, projectRoot: app.projectRoot };
}

/**
 * Gate a destructive dev-data operation: `--force` skips, TTY prompts,
 * non-interactive without `--force` fails.
 */
export async function confirmDestructiveAction(
  isNonInteractive: boolean,
  force: boolean,
  message: string,
  forceHint: string,
): Promise<void> {
  if (force) {
    return;
  }
  if (isNonInteractive) {
    throw new InvalidInputError(forceHint);
  }
  const confirmed = await confirm({ message });
  if (isCancel(confirmed) || !confirmed) {
    cancel("Operation cancelled.");
    throw new CLIExitError(0);
  }
}

/** POST an admin endpoint on the running dev server, Zod-parse the response. */
async function callAdminEndpoint<Schema extends z.ZodType>(
  instance: DevInstance,
  path: string,
  body: unknown,
  schema: Schema,
): Promise<z.infer<Schema>> {
  const url = `${instance.url}${DEV_ADMIN_BASE_PATH}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [DEV_ADMIN_HEADER]: instance.adminToken,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(`Failed to reach the dev server at ${instance.url}`, {
      requestUrl: url,
      cause: error instanceof Error ? error : undefined,
    });
  }

  const responseBody: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      (responseBody as { error?: string } | undefined)?.error ??
      `Dev server responded with status ${response.status}`;
    throw new ApiError(message, {
      statusCode: response.status,
      requestUrl: url,
      responseBody,
    });
  }

  const result = schema.safeParse(responseBody);
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from the dev server",
      result.error,
    );
  }
  return result.data;
}

export async function seedViaInstance(
  instance: DevInstance,
  mode: SeedMode,
): Promise<SeedSummary> {
  return await callAdminEndpoint(
    instance,
    "/seed",
    { mode },
    SeedSummarySchema,
  );
}

export async function resetViaInstance(
  instance: DevInstance,
): Promise<DevResetResult> {
  return await callAdminEndpoint(instance, "/reset", {}, DevResetResultSchema);
}

interface OfflineDatabase {
  db: Database;
  projectData: ProjectData;
  dataDir: string;
}

/**
 * Open the project's local datastore directly (no dev server running),
 * guarding against data that belongs to a different app — same rule as
 * `base44 dev` startup.
 */
async function openOfflineDatabase(
  app: DevProjectContext,
): Promise<OfflineDatabase> {
  const projectData = await readProjectConfig(app.projectRoot);
  const dataDir = getDataDir(app.projectRoot);

  const meta = await readDataDirMeta(dataDir);
  if (meta.status === "ok" && meta.meta.appId !== app.id) {
    throw new ConfigInvalidError(
      `Local dev data in ${dataDir} belongs to app "${meta.meta.appId}", but this project is linked to app "${app.id}".`,
      getMetaJsonPath(dataDir),
      {
        hints: [
          {
            message:
              "Run 'base44 dev --fresh' to delete the local data and start clean",
            command: "base44 dev --fresh",
          },
        ],
      },
    );
  }

  const db = new Database({ dataDir });
  await db.load(projectData.entities);
  return { db, projectData, dataDir };
}

export async function seedOffline(
  app: DevProjectContext,
  mode: SeedMode,
): Promise<SeedSummary> {
  const { db, projectData, dataDir } = await openOfflineDatabase(app);
  const seedData = await readSeedFiles(projectData.project);
  if (!seedData) {
    return emptySeedSummary(mode);
  }

  const summary = await applySeeds(db, seedData, { mode });
  await writeDataDirMeta(dataDir, {
    formatVersion: 1,
    appId: app.id,
    seed: { hash: seedData.hash, appliedAt: new Date().toISOString() },
  });
  return summary;
}

export async function resetOffline(
  app: DevProjectContext,
): Promise<DevResetResult> {
  const { db, projectData, dataDir } = await openOfflineDatabase(app);
  await db.resetData();

  const seedData = await readSeedFiles(projectData.project);
  const summary = seedData
    ? await applySeeds(db, seedData, { mode: "replace" })
    : null;

  await writeDataDirMeta(dataDir, {
    formatVersion: 1,
    appId: app.id,
    seed: seedData
      ? { hash: seedData.hash, appliedAt: new Date().toISOString() }
      : null,
  });

  return {
    reset: true,
    seeded: summary?.applied ?? false,
    dataDir,
    seed: summary,
  };
}

/** Print per-fixture counts and warnings (human, non-json output). */
export function logSeedSummary(log: Logger, summary: SeedSummary): void {
  log.info(formatSeedCounts(summary).join("\n"));
  for (const warning of summary.warnings) {
    log.warn(warning);
  }
}
