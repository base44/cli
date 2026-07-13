import type { Request, Response, Router } from "express";
import { Router as createRouter, json } from "express";
import { z } from "zod";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";
import { isUserError as isCLIUserError } from "@/core/errors.js";
import {
  type DevResetResult,
  type SeedMode,
  SeedModeSchema,
  type SeedState,
  type SeedSummary,
} from "@/core/index.js";
import { EntityValidationError } from "../db/validator.js";

/** Header carrying the per-instance admin token from dev.json. */
export const DEV_ADMIN_HEADER = "x-base44-dev-admin";

/** Local admin API base path (mounted on the dev-server Express app). */
export const DEV_ADMIN_BASE_PATH = "/_base44/dev";

export interface DevServerStatus {
  appId: string;
  port: number;
  startedAt: string;
  seed: SeedState;
  collections: Record<string, number>;
}

const SeedBodySchema = z.object({
  mode: SeedModeSchema.default("upsert"),
});

export interface AdminRouterDeps {
  adminToken: string;
  logger: DevLogger;
  getStatus: () => Promise<DevServerStatus>;
  runSeed: (mode: SeedMode) => Promise<SeedSummary>;
  runReset: () => Promise<DevResetResult>;
}

/** Seed/validation problems are the caller's to fix — report them as 400. */
function isUserError(error: unknown): boolean {
  return error instanceof EntityValidationError || isCLIUserError(error);
}

function handleError(
  error: unknown,
  res: Response,
  logger: DevLogger,
  operation: string,
): void {
  const message = error instanceof Error ? error.message : String(error);
  if (isUserError(error)) {
    res.status(400).json({ error: message });
    return;
  }
  logger.error(`Error in ${operation}:`, error);
  res.status(500).json({ error: message });
}

/**
 * Local admin endpoints (`/_base44/dev/*`). Every route requires the
 * per-instance admin token from dev.json in the `x-base44-dev-admin` header.
 */
export function createAdminRouter({
  adminToken,
  logger,
  getStatus,
  runSeed,
  runReset,
}: AdminRouterDeps): Router {
  const router = createRouter();

  router.use((req: Request, res: Response, next) => {
    if (req.headers[DEV_ADMIN_HEADER] !== adminToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  router.get("/status", async (_req, res) => {
    try {
      res.json(await getStatus());
    } catch (error) {
      handleError(error, res, logger, "GET /_base44/dev/status");
    }
  });

  router.post("/seed", json(), async (req, res) => {
    const body = SeedBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: 'mode must be "upsert" or "replace"' });
      return;
    }
    try {
      res.json(await runSeed(body.data.mode));
    } catch (error) {
      handleError(error, res, logger, "POST /_base44/dev/seed");
    }
  });

  router.post("/reset", async (_req, res) => {
    try {
      res.json(await runReset());
    } catch (error) {
      handleError(error, res, logger, "POST /_base44/dev/reset");
    }
  });

  return router;
}
