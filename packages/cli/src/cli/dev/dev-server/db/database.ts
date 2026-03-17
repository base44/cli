import Datastore from "@seald-io/nedb";
import type { Entity } from "@/core/resources/entity/schema.js";
import { type EntityRecord, Validator } from "./validator.js";

export class Database {
  private collections: Map<string, Datastore> = new Map();
  private schemas: Map<string, Entity> = new Map();
  private validator: Validator = new Validator();

  load(entities: Entity[]) {
    for (const entity of entities) {
      this.collections.set(entity.name, new Datastore());
      this.schemas.set(entity.name, entity);
    }
  }

  getCollection(name: string): Datastore | undefined {
    return this.collections.get(name);
  }

  getCollectionNames(): string[] {
    return Array.from(this.collections.keys());
  }

  dropAll() {
    for (const collection of this.collections.values()) {
      collection.remove({}, { multi: true });
    }
    this.collections.clear();
    this.schemas.clear();
  }

  validate(entityName: string, record: EntityRecord, partial: boolean = false) {
    const schema = this.schemas.get(entityName);
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
    const schema = this.schemas.get(entityName);
    if (!schema) {
      throw new Error(`Entity "${entityName}" not found`);
    }

    const filteredRecord = this.validator.filterFields(record, schema);
    if (partial) {
      return filteredRecord;
    }
    return this.validator.applyDefaults(filteredRecord, schema);
  }
}
