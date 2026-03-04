import Datastore from "@seald-io/nedb";
import type { Entity } from "@/core/resources/entity/schema.js";

export class Database {
  private collections: Map<string, Datastore>;

  constructor(entities: Entity[]) {
    this.collections = new Map();
    for (const entity of entities) {
      this.collections.set(entity.name, new Datastore());
    }
  }

  getCollection(name: string): Datastore | undefined {
    return this.collections.get(name);
  }

  getCollectionNames(): string[] {
    return Array.from(this.collections.keys());
  }
}
