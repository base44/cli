import { createHash } from "node:crypto";
import { basename, dirname, join, relative, sep } from "node:path";
import { globby } from "globby";
import { CONFIG_FILE_EXTENSION_GLOB } from "@/core/consts.js";
import { SchemaValidationError } from "@/core/errors.js";
import { pathExists, readFile, readJsonFile } from "@/core/utils/fs.js";
import {
  type SeedRecord,
  SeedRecordsFileSchema,
  type SeedUser,
  SeedUsersFileSchema,
} from "./schema.js";

/**
 * File base name (case-insensitive) reserved for the users fixture. Never
 * resolved as an entity fixture.
 */
export const USERS_FIXTURE_BASENAME = "users";

/** Fixed script hook path, relative to the project config dir (phase C). */
const SEED_SCRIPT_FILENAME = "seed.ts";

export interface SeedUsersFixture {
  path: string;
  /** Path relative to the config dir, forward slashes (messages + hashing). */
  relPath: string;
  users: SeedUser[];
}

export interface SeedRecordsFixture {
  path: string;
  relPath: string;
  /** File base name without extension; resolved to an entity at apply time. */
  baseName: string;
  records: SeedRecord[];
}

export interface SeedData {
  users: SeedUsersFixture | null;
  /** Entity fixtures, sorted alphabetically by filename (application order). */
  fixtures: SeedRecordsFixture[];
  /** Absolute path of `seed.ts` when present; run by phase C, hashed here. */
  scriptPath: string | null;
  /** `sha256:<hex>` over all seed files; drives the "seed changed" hint. */
  hash: string;
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function fileBaseName(path: string): string {
  return basename(path).replace(/\.[^.]+$/, "");
}

/**
 * Hash seed file contents so any change (add/remove/edit) changes the hash,
 * independent of filesystem enumeration order.
 */
export function computeSeedHash(
  entries: { relPath: string; bytes: Uint8Array }[],
): string {
  const hash = createHash("sha256");
  const sorted = [...entries].sort((a, b) =>
    a.relPath.localeCompare(b.relPath),
  );
  for (const entry of sorted) {
    hash.update(entry.relPath);
    hash.update("\0");
    hash.update(entry.bytes);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Read and validate the project's seed fixtures (`<seedDir>/*.jsonc`).
 * Returns null when the project has no seed files at all. Fixture contents
 * are validated structurally here; per-record entity validation happens at
 * apply time against the live schemas.
 */
export async function readSeedFiles(project: {
  configPath: string;
  seedDir: string;
}): Promise<SeedData | null> {
  const configDir = dirname(project.configPath);
  const seedDir = join(configDir, project.seedDir);
  const scriptPath = join(configDir, SEED_SCRIPT_FILENAME);
  const hasScript = await pathExists(scriptPath);

  const files = (await pathExists(seedDir))
    ? await globby(`*.${CONFIG_FILE_EXTENSION_GLOB}`, {
        cwd: seedDir,
        absolute: true,
      })
    : [];
  files.sort((a, b) => basename(a).localeCompare(basename(b)));

  if (files.length === 0 && !hasScript) {
    return null;
  }

  const hashFiles = hasScript ? [...files, scriptPath] : files;
  const hash = computeSeedHash(
    await Promise.all(
      hashFiles.map(async (path) => ({
        relPath: toPosix(relative(configDir, path)),
        bytes: new Uint8Array(await readFile(path)),
      })),
    ),
  );

  let users: SeedUsersFixture | null = null;
  const fixtures: SeedRecordsFixture[] = [];

  for (const path of files) {
    const relPath = toPosix(relative(configDir, path));
    const baseName = fileBaseName(path);
    const parsed = await readJsonFile(path);

    if (baseName.toLowerCase() === USERS_FIXTURE_BASENAME) {
      const result = SeedUsersFileSchema.safeParse(parsed);
      if (!result.success) {
        throw new SchemaValidationError(
          "Invalid seed users file",
          result.error,
          path,
        );
      }
      users = { path, relPath, users: result.data };
    } else {
      const result = SeedRecordsFileSchema.safeParse(parsed);
      if (!result.success) {
        throw new SchemaValidationError(
          "Invalid seed fixture file",
          result.error,
          path,
        );
      }
      fixtures.push({ path, relPath, baseName, records: result.data });
    }
  }

  return { users, fixtures, scriptPath: hasScript ? scriptPath : null, hash };
}

/**
 * Normalize a name for fixture-to-entity resolution: lowercase with `-`/`_`
 * stripped, so `team-member.jsonc` resolves the entity named "TeamMember".
 */
export function normalizeSeedName(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, "");
}
