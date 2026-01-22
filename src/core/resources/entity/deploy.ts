import { syncEntities } from "./api.js";
import type { Entity, SyncEntitiesResponse } from "./schema.js";

export async function pushEntities(
  entities: Entity[]
): Promise<SyncEntitiesResponse> {
  if (entities.length === 0) {
    return { created: [], updated: [], deleted: [] };
  }

  return syncEntities(entities);
}
