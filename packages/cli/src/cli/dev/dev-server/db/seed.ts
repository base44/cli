import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { nanoid } from "nanoid";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";
import { readJsonFile } from "@/core/utils/fs.js";
import { getNowISOTimestamp } from "../utils.js";
import { type Database, USER_COLLECTION } from "./database.js";

/**
 * Seeds the in-memory dev database from JSON fixtures so a fresh `base44 dev`
 * boot (or a hot-reload that cleared the store) starts with predictable data.
 *
 * Convention: every `<seedDir>/<EntityName>.json` file holds an array of
 * records for that entity. `User.json` is special — records are upserted into
 * the built-in User collection by email (so you can add extra users with
 * specific `role`s to exercise RLS / role-gated pages), and existing users
 * (like the seeded CLI admin) are left untouched.
 *
 * Missing seed dir / empty files are a no-op. A file naming an unknown entity
 * is skipped with a warning rather than failing the whole boot.
 */
export async function seedDatabase(
  db: Database,
  seedDir: string,
  logger: DevLogger,
): Promise<void> {
  let files: string[];
  try {
    files = await readdir(seedDir);
  } catch {
    // No seed directory — nothing to do.
    return;
  }

  for (const file of files.sort()) {
    if (extname(file).toLowerCase() !== ".json") {
      continue;
    }

    const entityName = basename(file, extname(file));
    const collection = db.getCollection(entityName);
    if (!collection) {
      logger.warn(
        `Seed: no entity named "${entityName}", skipping ${file}. ` +
          `Name the file after an entity (e.g. base44/seed/Task.json).`,
      );
      continue;
    }

    let records: unknown;
    try {
      records = await readJsonFile(join(seedDir, file));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Seed: failed to read ${file}: ${message}`);
      continue;
    }

    if (!Array.isArray(records)) {
      logger.warn(`Seed: ${file} must contain a JSON array of records.`);
      continue;
    }

    const isUserCollection = db.getCollection(USER_COLLECTION) === collection;

    let inserted = 0;
    for (const raw of records) {
      if (!raw || typeof raw !== "object") {
        logger.warn(`Seed: skipping non-object record in ${file}.`);
        continue;
      }
      try {
        if (isUserCollection) {
          inserted += await seedUser(
            db,
            raw as Record<string, unknown>,
            logger,
          );
        } else {
          await seedRecord(db, entityName, raw as Record<string, unknown>);
          inserted += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Seed: skipping invalid record in ${file}: ${message}`);
      }
    }

    if (inserted > 0) {
      logger.log(`Seeded ${inserted} ${entityName} record(s)`);
    }
  }
}

/** Upsert a seeded user by email; never clobber an existing one. */
async function seedUser(
  db: Database,
  raw: Record<string, unknown>,
  logger: DevLogger,
): Promise<number> {
  const email = typeof raw.email === "string" ? raw.email : undefined;
  if (!email) {
    logger.warn("Seed: a User record is missing an `email`, skipping.");
    return 0;
  }

  const collection = db.getCollection(USER_COLLECTION);
  const existing = await collection?.findOneAsync({ email });
  if (existing) {
    // The CLI admin (and any already-seeded user) wins — seeding is additive.
    return 0;
  }

  const now = getNowISOTimestamp();
  const { id, full_name, role, ...rest } = raw;
  await collection?.insertAsync({
    ...rest,
    id: typeof id === "string" ? id : nanoid(),
    email,
    full_name: typeof full_name === "string" ? full_name : email,
    role: typeof role === "string" ? role : "user",
    is_service: false,
    is_verified: true,
    disabled: null,
    created_date: now,
    updated_date: now,
  });
  return 1;
}

/** Insert a seeded record for a custom entity, validated against its schema. */
async function seedRecord(
  db: Database,
  entityName: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const { id, created_date, updated_date, ...body } = raw;
  const prepared = db.prepareRecord(entityName, body);
  db.validate(entityName, prepared);

  const now = getNowISOTimestamp();
  await db.getCollection(entityName)?.insertAsync({
    ...prepared,
    id: typeof id === "string" ? id : nanoid(),
    created_date: typeof created_date === "string" ? created_date : now,
    updated_date: typeof updated_date === "string" ? updated_date : now,
  });
}
