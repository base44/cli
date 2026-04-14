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

export class Database {
  private collections: Map<string, Datastore> = new Map();
  private schemas: Map<string, Entity> = new Map();
  private validator: Validator = new Validator();

  async load(entities: Entity[]) {
    await this.loadUserCollection(entities);

    for (const entity of entities) {
      const entityName = this.normalizeName(entity.name);
      if (entityName === USER_COLLECTION) {
        continue;
      }

      this.collections.set(entityName, new Datastore());
      this.schemas.set(entityName, entity);
    }
  }

  private async loadUserCollection(entities: Entity[]) {
    const userEntity = entities.find(
      (e) => this.normalizeName(e.name) === USER_COLLECTION,
    );

    this.schemas.set(USER_COLLECTION, this.buildUserSchema(userEntity));

    const collection = new Datastore();
    this.collections.set(USER_COLLECTION, collection);

    // Private user collection will store data that is not accessible for the client.
    // Data like password.
    this.collections.set(PRIVATE_USER_COLLECTION, new Datastore());

    const userInfo = await readAuth();
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
