import { syncEntities } from "@/core/resources/entity/api.js";
import type {
  Entity,
  SyncEntitiesResponse,
} from "@/core/resources/entity/schema.js";

export async function pushEntities(
  entities: Entity[]
): Promise<SyncEntitiesResponse> {
  if (entities.length === 0) {
    return { created: [], updated: [], deleted: [] };
  }

  return syncEntities(entities);
}
