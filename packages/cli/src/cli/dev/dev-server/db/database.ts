import { join } from "node:path";
import Datastore from "@seald-io/nedb";
import { nanoid } from "nanoid";
import { readAuth } from "@/core/index.js";
import type { Entity } from "@/core/resources/entity/schema.js";
import { getNowISOTimestamp } from "../utils.js";
import { type EntityRecord, Validator } from "./validator.js";

// Developer can't create collection with names that are not alphanumeric.
const PRIVATE_COLLECTION_PREFIX = "$";

export const USER_COLLECTION = "user";
export const PRIVATE_USER_COLLECTION =
  PRIVATE_COLLECTION_PREFIX + USER_COLLECTION;

interface DatabaseOptions {
  /**
   * Directory for file-backed NeDB collections (one `<name>.db` per
   * collection). Omit for the in-memory database used by tests.
   */
  dataDir?: string;
}

export class Database {
  private collections: Map<string, Datastore> = new Map();
  private schemas: Map<string, Entity> = new Map();
  private validator: Validator = new Validator();
  private readonly dataDir?: string;

  constructor(options: DatabaseOptions = {}) {
    this.dataDir = options.dataDir;
  }

  async load(entities: Entity[]) {
    this.applySchemas(entities);
    this.ensureCollections(entities);
    await this.bootstrapCliUser();
    await this.compactAll();
  }

  /**
   * Replace entity schemas without touching stored data. Collections for new
   * entities are created; collections for removed entities are dropped from
   * the map but their on-disk files are left untouched.
   */
  reloadSchemas(entities: Entity[]) {
    this.applySchemas(entities);
    this.ensureCollections(entities);
    for (const name of this.collections.keys()) {
      if (
        !this.schemas.has(name) &&
        !name.startsWith(PRIVATE_COLLECTION_PREFIX)
      ) {
        this.collections.delete(name);
      }
    }
  }

  private applySchemas(entities: Entity[]) {
    const userEntity = entities.find(
      (e) => this.normalizeName(e.name) === USER_COLLECTION,
    );
    // Build before clearing so an invalid User schema leaves the current
    // schemas intact (the watcher logs the error and keeps serving).
    const userSchema = this.buildUserSchema(userEntity);

    this.schemas.clear();
    this.schemas.set(USER_COLLECTION, userSchema);

    for (const entity of entities) {
      const entityName = this.normalizeName(entity.name);
      if (entityName === USER_COLLECTION) {
        continue;
      }
      this.schemas.set(entityName, entity);
    }
  }

  private ensureCollections(entities: Entity[]) {
    this.ensureCollection(USER_COLLECTION);
    // Private user collection will store data that is not accessible for the client.
    // Data like password.
    this.ensureCollection(PRIVATE_USER_COLLECTION);

    for (const entity of entities) {
      this.ensureCollection(this.normalizeName(entity.name));
    }
  }

  private ensureCollection(normalizedName: string) {
    if (this.collections.has(normalizedName)) {
      return;
    }
    const datastore = this.dataDir
      ? new Datastore({
          filename: join(this.dataDir, `${normalizedName}.db`),
          autoload: true,
        })
      : new Datastore();
    this.collections.set(normalizedName, datastore);
  }

  /**
   * Insert the logged-in CLI user as the local admin unless a user with that
   * email already exists (idempotent across dev-server restarts).
   */
  private async bootstrapCliUser() {
    const collection = this.collections.get(USER_COLLECTION);
    if (!collection) {
      return;
    }

    const userInfo = await readAuth();
    const existing = await collection.findOneAsync({ email: userInfo.email });
    if (existing) {
      return;
    }

    const now = getNowISOTimestamp();
    await collection.insertAsync({
      id: nanoid(),
      email: userInfo.email,
      full_name: userInfo.name,
      is_service: false,
      is_verified: true,
      disabled: null,
      role: "admin",
      collaborator_role: "editor",
      created_date: now,
      updated_date: now,
    });
  }

  /** Compact file-backed datafiles after load; no-op for in-memory mode. */
  private async compactAll() {
    if (!this.dataDir) {
      return;
    }
    await Promise.all(
      Array.from(this.collections.values(), (collection) =>
        collection.compactDatafileAsync(),
      ),
    );
  }

  private buildUserSchema(customUserEntity: Entity | undefined): Entity {
    const builtInFields = {
      full_name: { type: "string" as const },
      email: { type: "string" as const },
    };

    if (!customUserEntity) {
      return {
        name: "User",
        type: "object",
        properties: { ...builtInFields, role: { type: "string" } },
        source: { type: "project" },
      };
    }

    for (const field of Object.keys(builtInFields)) {
      if (field in customUserEntity.properties) {
        throw new Error(
          `Error syncing entities: Invalid User schema: User schema cannot contain base fields: ${field}. These fields are built-in and managed by the system.`,
        );
      }
    }

    return {
      ...customUserEntity,
      properties: { ...customUserEntity.properties, ...builtInFields },
    };
  }

  getCollection(name: string): Datastore | undefined {
    return this.collections.get(this.normalizeName(name));
  }

  getSchema(entityName: string): Entity | undefined {
    return this.schemas.get(this.normalizeName(entityName));
  }

  /** Returns public collection names: public = accessible to the user  */
  getCollectionNames(): string[] {
    return Array.from(this.collections.keys()).filter((name) => {
      return !name.startsWith(PRIVATE_COLLECTION_PREFIX);
    });
  }

  dropAll() {
    for (const collection of this.collections.values()) {
      collection.remove({}, { multi: true });
    }
    this.collections.clear();
    this.schemas.clear();
  }

  validate(entityName: string, record: EntityRecord, partial: boolean = false) {
    const schema = this.schemas.get(this.normalizeName(entityName));
    if (!schema) {
      throw new Error(`Entity "${entityName}" not found`);
    }

    return this.validator.validate(record, schema, partial);
  }

  prepareRecord(
    entityName: string,
    record: EntityRecord,
    partial: boolean = false,
  ) {
    const schema = this.schemas.get(this.normalizeName(entityName));
    if (!schema) {
      throw new Error(`Entity "${entityName}" not found`);
    }

    const filteredRecord = this.validator.filterFields(record, schema);
    if (partial) {
      return filteredRecord;
    }
    return this.validator.applyDefaults(filteredRecord, schema);
  }

  private normalizeName(entityName: string): string {
    return entityName.toLowerCase();
  }
}
