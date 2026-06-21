import { readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { getDevEnvsDir } from "@/core/config.js";
import {
  makeDirectory,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "@/core/utils/fs.js";

/**
 * A background dev env, modelled loosely on a Docker container: a named,
 * isolated `base44 dev` process with its own port, logical database and log
 * file. The registry persists one of these per env under `~/.base44/dev-envs/`
 * so the env outlives the agent/shell that started it and can be listed,
 * inspected, tailed and stopped by name later.
 */
export const DevEnvSchema = z.object({
  name: z.string(),
  appId: z.string(),
  projectRoot: z.string(),
  port: z.number(),
  url: z.string(),
  pid: z.number(),
  logPath: z.string(),
  status: z.enum(["starting", "running", "stopped", "error"]),
  createdAt: z.string(),
});

export type DevEnv = z.infer<typeof DevEnvSchema>;

const META_FILE = "env.json";
const LOG_FILE = "dev.log";

function envDir(name: string): string {
  return join(getDevEnvsDir(), name);
}

export function getEnvMetaPath(name: string): string {
  return join(envDir(name), META_FILE);
}

export function getEnvLogPath(name: string): string {
  return join(envDir(name), LOG_FILE);
}

/**
 * Derive a stable, filesystem-safe default env name from the project path.
 * Each git worktree lives in its own directory, so this naturally gives every
 * worktree a distinct env (no port/data collisions between parallel agents).
 */
export function defaultEnvName(projectRoot: string): string {
  const base = basename(projectRoot) || "app";
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "app";
}

/** A process id is "alive" if signal 0 doesn't throw ESRCH. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but we can't signal it — still alive.
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

export async function writeEnv(env: DevEnv): Promise<void> {
  await makeDirectory(envDir(env.name));
  await writeJsonFile(getEnvMetaPath(env.name), env);
}

export async function readEnv(name: string): Promise<DevEnv | null> {
  const metaPath = getEnvMetaPath(name);
  if (!(await pathExists(metaPath))) {
    return null;
  }
  const raw = await readJsonFile(metaPath);
  const parsed = DevEnvSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function removeEnv(name: string): Promise<void> {
  await rm(envDir(name), { recursive: true, force: true });
}

/**
 * List all known envs, reconciling recorded status against live process state
 * so a crashed/killed daemon shows up as `stopped` rather than `running`.
 */
export async function listEnvs(): Promise<DevEnv[]> {
  const dir = getDevEnvsDir();
  if (!(await pathExists(dir))) {
    return [];
  }
  const names = await readdir(dir);
  const envs: DevEnv[] = [];
  for (const name of names) {
    const env = await readEnv(name);
    if (!env) {
      continue;
    }
    const alive = isPidAlive(env.pid);
    envs.push(
      alive
        ? env
        : { ...env, status: env.status === "starting" ? "error" : "stopped" },
    );
  }
  return envs.sort((a, b) => a.name.localeCompare(b.name));
}

/** Update a subset of fields on a persisted env (no-op if it's gone). */
export async function patchEnv(
  name: string,
  patch: Partial<DevEnv>,
): Promise<void> {
  const env = await readEnv(name);
  if (!env) {
    return;
  }
  await writeEnv({ ...env, ...patch });
}
