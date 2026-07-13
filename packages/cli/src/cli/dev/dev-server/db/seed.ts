import type Datastore from "@seald-io/nedb";
import { nanoid } from "nanoid";
import { SERVICE_USER } from "@/cli/dev/dev-server/routes/entities/current-user.js";
import { InvalidInputError } from "@/core/errors.js";
import type { Entity } from "@/core/resources/entity/schema.js";
import {
  normalizeSeedName,
  type SeedData,
  type SeedEntityCounts,
  type SeedMode,
  type SeedRecordsFixture,
  type SeedSummary,
  type SeedUsersFixture,
  USERS_FIXTURE_BASENAME,
} from "@/core/resources/seed/index.js";
import type { EntityEvent } from "../realtime.js";
import { stripInternalFields } from "../utils.js";
import { prepareRecordForCreate, type RecordOwner } from "./create-record.js";
import {
  type Database,
  PRIVATE_USER_COLLECTION,
  USER_COLLECTION,
} from "./database.js";
import {
  buildUserDocument,
  fullNameFromEmail,
  upsertUserCredentials,
} from "./users.js";
import { type EntityRecord, EntityValidationError } from "./validator.js";

export interface ApplySeedsOptions {
  mode: SeedMode;
  /** Realtime broadcast hook (dev-server path); best effort, omit offline. */
  emit?: (entityName: string, event: EntityEvent) => void;
}

interface SeededUserDocument extends Record<string, unknown> {
  id: string;
  email: string;
}

function invalidSeedRecord(
  relPath: string,
  index: number,
  message: string,
): InvalidInputError {
  return new InvalidInputError(
    `Invalid seed record in ${relPath} at index ${index}: ${message}`,
  );
}

function requireCollection(db: Database, name: string): Datastore {
  const collection = db.getCollection(name);
  if (!collection) {
    throw new InvalidInputError(`Collection "${name}" not found`);
  }
  return collection;
}

function emitEvent(
  emit: ApplySeedsOptions["emit"],
  entityName: string,
  type: EntityEvent["type"],
  record: EntityRecord,
): void {
  const data = stripInternalFields(record);
  emit?.(entityName, {
    type,
    data,
    id: data.id as string,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Upsert seed users by email through the same building blocks as local
 * registration: public fields into the user collection (verified), password
 * into the private user collection. Existing users keep their id and
 * created_date, so issued tokens stay valid. Never deletes users — the CLI
 * login user and locally registered users survive every mode.
 */
async function applyUsersFixture(
  db: Database,
  fixture: SeedUsersFixture,
): Promise<number> {
  const userCollection = requireCollection(db, USER_COLLECTION);
  const privateUserCollection = requireCollection(db, PRIVATE_USER_COLLECTION);

  for (const [index, seedUser] of fixture.users.entries()) {
    const { email, role, password, full_name, ...customFields } = seedUser;

    const custom = db.prepareRecord(USER_COLLECTION, customFields, true);
    try {
      db.validate(USER_COLLECTION, custom, true);
    } catch (error) {
      if (error instanceof EntityValidationError) {
        throw invalidSeedRecord(fixture.relPath, index, error.message);
      }
      throw error;
    }

    const existing = await userCollection.findOneAsync<SeededUserDocument>({
      email,
    });
    const document = {
      ...buildUserDocument({
        id: existing?.id ?? nanoid(),
        email,
        fullName: full_name ?? fullNameFromEmail(email),
        role,
        createdDate: existing?.created_date as string | undefined,
      }),
      ...custom,
    };

    if (existing) {
      await userCollection.updateAsync({ email }, document);
    } else {
      await userCollection.insertAsync(document);
    }

    if (password !== undefined) {
      await upsertUserCredentials(privateUserCollection, {
        id: document.id as string,
        email,
        password,
      });
    }
  }

  return fixture.users.length;
}

interface ResolvedEntity {
  schema: Entity;
  collection: Datastore;
}

/**
 * Resolve a fixture file base name to an entity schema by normalized
 * comparison (lowercased, `-`/`_` stripped), so `task.jsonc`, `Task.jsonc`,
 * and `team-member.jsonc` all resolve. The user collection is reserved for
 * the users fixture.
 */
function resolveEntity(db: Database, baseName: string): ResolvedEntity | null {
  const target = normalizeSeedName(baseName);
  for (const name of db.getCollectionNames()) {
    if (name === USER_COLLECTION) {
      continue;
    }
    const schema = db.getSchema(name);
    if (schema && normalizeSeedName(schema.name) === target) {
      const collection = db.getCollection(name);
      if (collection) {
        return { schema, collection };
      }
    }
  }
  return null;
}

async function resolveOwner(
  userCollection: Datastore,
  createdBy: string | undefined,
): Promise<RecordOwner | undefined> {
  if (createdBy === undefined) {
    return undefined;
  }
  const user = await userCollection.findOneAsync<SeededUserDocument>({
    email: createdBy,
  });
  if (!user) {
    throw new Error(`created_by references unknown user "${createdBy}"`);
  }
  return { email: user.email, id: user.id };
}

/**
 * Apply one entity fixture. All records are resolved and validated before
 * any write, so an invalid file leaves its collection untouched.
 *
 * - `upsert`: records with an id are updated-or-inserted by id; id-less
 *   records are skipped. Never deletes.
 * - `replace`: the collection is truncated, then every record (including
 *   id-less ones) is inserted.
 */
async function applyRecordsFixture(
  db: Database,
  { schema, collection }: ResolvedEntity,
  fixture: SeedRecordsFixture,
  mode: SeedMode,
  emit: ApplySeedsOptions["emit"],
): Promise<SeedEntityCounts> {
  const userCollection = requireCollection(db, USER_COLLECTION);
  const now = new Date().toISOString();

  const prepared: { document: EntityRecord; hasId: boolean }[] = [];
  for (const [index, seedRecord] of fixture.records.entries()) {
    const { id, created_by, ...body } = seedRecord;
    try {
      const owner = await resolveOwner(userCollection, created_by);
      const document = prepareRecordForCreate(db, schema.name, schema, body, {
        actor: SERVICE_USER,
        owner,
        now,
        id,
      });
      prepared.push({ document, hasId: id !== undefined });
    } catch (error) {
      if (error instanceof Error) {
        throw invalidSeedRecord(fixture.relPath, index, error.message);
      }
      throw error;
    }
  }

  const counts: SeedEntityCounts = { created: 0, updated: 0, skipped: 0 };

  if (mode === "replace") {
    await collection.removeAsync({}, { multi: true });
    for (const { document } of prepared) {
      const inserted = await collection.insertAsync(document);
      counts.created++;
      emitEvent(emit, schema.name, "create", inserted);
    }
    return counts;
  }

  for (const { document, hasId } of prepared) {
    if (!hasId) {
      counts.skipped++;
      continue;
    }
    const existing = await collection.findOneAsync({ id: document.id });
    if (existing) {
      const { created_date: _created_date, ...updateFields } = document;
      const { affectedDocuments } = await collection.updateAsync(
        { id: document.id },
        { $set: { ...updateFields, updated_date: now } },
        { returnUpdatedDocs: true },
      );
      counts.updated++;
      if (affectedDocuments) {
        emitEvent(emit, schema.name, "update", affectedDocuments);
      }
    } else {
      const inserted = await collection.insertAsync(document);
      counts.created++;
      emitEvent(emit, schema.name, "create", inserted);
    }
  }

  return counts;
}

/**
 * Apply seed fixtures to the local database: users first, then entity
 * fixtures in filename order. Seeding runs as service role (bypasses RLS and
 * FLS); records are stamped with id/created_by/created_date/updated_date
 * exactly like the entity POST route. The `script` step (base44/seed.ts) is
 * not part of fixture application and is reported as null here.
 */
export async function applySeeds(
  db: Database,
  seedData: SeedData,
  { mode, emit }: ApplySeedsOptions,
): Promise<SeedSummary> {
  const warnings: string[] = [];

  const reservedEntity = db
    .getCollectionNames()
    .map((name) => db.getSchema(name))
    .find(
      (schema) =>
        schema && normalizeSeedName(schema.name) === USERS_FIXTURE_BASENAME,
    );
  if (seedData.users && reservedEntity) {
    warnings.push(
      `Entity "${reservedEntity.name}" collides with the reserved users.jsonc fixture name; ${seedData.users.relPath} is applied as the users fixture`,
    );
  }

  const users = seedData.users
    ? await applyUsersFixture(db, seedData.users)
    : 0;

  const records: Record<string, SeedEntityCounts> = {};
  for (const fixture of seedData.fixtures) {
    if (normalizeSeedName(fixture.baseName) === USER_COLLECTION) {
      warnings.push(
        `Seed fixture "${fixture.relPath}" targets the built-in User entity — use users.jsonc to seed users; file skipped`,
      );
      continue;
    }
    const resolved = resolveEntity(db, fixture.baseName);
    if (!resolved) {
      warnings.push(
        `Seed fixture "${fixture.relPath}" does not match any entity; file skipped`,
      );
      continue;
    }
    records[resolved.schema.name] = await applyRecordsFixture(
      db,
      resolved,
      fixture,
      mode,
      emit,
    );
  }

  return { applied: true, mode, users, records, script: null, warnings };
}
