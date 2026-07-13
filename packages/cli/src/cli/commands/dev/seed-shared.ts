import type { Logger } from "@base44-cli/logger";
import { cancel, confirm, isCancel } from "@clack/prompts";
import getPort from "get-port";
import { z } from "zod";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";
import { Database } from "@/cli/dev/dev-server/db/database.js";
import { applySeeds } from "@/cli/dev/dev-server/db/seed.js";
import { createDevServer } from "@/cli/dev/dev-server/main.js";
import {
  DEV_ADMIN_BASE_PATH,
  DEV_ADMIN_HEADER,
} from "@/cli/dev/dev-server/routes/admin-router.js";
import { formatSeedCounts } from "@/cli/dev/seed-summary.js";
import { CLIExitError } from "@/cli/errors.js";
import { getDenoWrapperPath } from "@/core/assets.js";
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

interface AdminRequest {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

/** Call an admin endpoint on the running dev server, Zod-parse the response. */
async function callAdminEndpoint<Schema extends z.ZodType>(
  instance: DevInstance,
  request: AdminRequest,
  schema: Schema,
): Promise<z.infer<Schema>> {
  const url = `${instance.url}${DEV_ADMIN_BASE_PATH}${request.path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method,
      headers: {
        "content-type": "application/json",
        [DEV_ADMIN_HEADER]: instance.adminToken,
      },
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
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
    { method: "POST", path: "/seed", body: { mode } },
    SeedSummarySchema,
  );
}

export async function resetViaInstance(
  instance: DevInstance,
): Promise<DevResetResult> {
  return await callAdminEndpoint(
    instance,
    { method: "POST", path: "/reset", body: {} },
    DevResetResultSchema,
  );
}

const DevExportSchema = z.object({
  collections: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

export type DevExport = z.infer<typeof DevExportSchema>;

/** Fetch local collections from a running dev server (`data dump` live path). */
export async function exportViaInstance(
  instance: DevInstance,
  entityNames?: string[],
): Promise<DevExport> {
  const query = entityNames?.length
    ? `?entities=${encodeURIComponent(entityNames.join(","))}`
    : "";
  return await callAdminEndpoint(
    instance,
    { method: "GET", path: `/export${query}` },
    DevExportSchema,
  );
}

export interface OfflineDatabase {
  db: Database;
  dataDir: string;
}

/**
 * Open the project's local datastore directly (no dev server running),
 * guarding against data that belongs to a different app — same rule as
 * `base44 dev` startup.
 */
export async function openOfflineDatabase(
  app: DevProjectContext,
  projectData: ProjectData,
): Promise<OfflineDatabase> {
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
  return { db, dataDir };
}

/** DevLogger that writes to stderr, keeping stdout pure under `--json`. */
function stderrDevLogger(): DevLogger {
  const write = (args: unknown[]) =>
    process.stderr.write(`${args.map(String).join(" ")}\n`);
  return {
    log: (...args) => write(args),
    warn: (...args) => write(args),
    error: (msg, err) => write(err === undefined ? [msg] : [msg, err]),
  };
}

/**
 * Boot a temporary internal dev-server instance on a random port so the
 * `seed.ts` script step has a server to talk to when none is running.
 * Ephemeral: no dev.json descriptor, no startup auto-seed (the callback
 * drives seeding through the admin endpoints), no frontend serve command.
 */
export async function withTempDevInstance<T>(
  app: DevProjectContext,
  log: Logger,
  fn: (instance: DevInstance) => Promise<T>,
): Promise<T> {
  const { url, port, adminToken, shutdown } = await createDevServer({
    log,
    port: await getPort(),
    appId: app.id,
    state: { projectRoot: app.projectRoot, ephemeral: true },
    denoWrapperPath: getDenoWrapperPath(),
    logger: stderrDevLogger(),
    loadResources: async () => {
      const { functions, entities, project } = await readProjectConfig(
        app.projectRoot,
      );
      // Never launch the project's frontend from a temporary instance.
      const site = project.site
        ? { ...project.site, serveCommand: undefined }
        : project.site;
      return { functions, entities, project: { ...project, site } };
    },
  });

  try {
    return await fn({
      appId: app.id,
      url,
      port,
      pid: process.pid,
      dataDir: getDataDir(app.projectRoot),
      adminToken,
      startedAt: new Date().toISOString(),
      seed: null,
    });
  } finally {
    await shutdown();
  }
}

export async function seedOffline(
  app: DevProjectContext,
  mode: SeedMode,
  log: Logger,
): Promise<SeedSummary> {
  const projectData = await readProjectConfig(app.projectRoot);
  const seedData = await readSeedFiles(projectData.project);
  if (!seedData) {
    return emptySeedSummary(mode);
  }

  if (seedData.scriptPath) {
    // seed.ts talks to the dev server over HTTP: boot a temporary instance
    // and drive fixtures + script through the same path as a live server.
    return await withTempDevInstance(app, log, (instance) =>
      seedViaInstance(instance, mode),
    );
  }

  const { db, dataDir } = await openOfflineDatabase(app, projectData);
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
  log: Logger,
): Promise<DevResetResult> {
  const projectData = await readProjectConfig(app.projectRoot);
  const seedData = await readSeedFiles(projectData.project);

  if (seedData?.scriptPath) {
    return await withTempDevInstance(app, log, (instance) =>
      resetViaInstance(instance),
    );
  }

  const { db, dataDir } = await openOfflineDatabase(app, projectData);
  await db.resetData();

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
