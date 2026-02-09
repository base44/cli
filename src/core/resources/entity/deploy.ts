import { join } from "node:path";
import { getEntities, syncEntities } from "@/core/resources/entity/api.js";
import type {
  Entity,
  SyncEntitiesResponse,
} from "@/core/resources/entity/schema.js";
import { writeJsonFile } from "@/core/utils";

export async function pushEntities(
  entities: Entity[]
): Promise<SyncEntitiesResponse> {
  if (entities.length === 0) {
    return { created: [], updated: [], deleted: [] };
  }

  return syncEntities(entities);
}

export async function pullEntities(projectPath: string): Promise<Entity[]> {
  const entities = await getEntities();
  
  entities.schemas.forEach((entity) => {
    writeJsonFile(join(projectPath, 'base44', 'entities', `${entity.entityName}.json`), entity.entitySchema);
  });

  return entities.schemas.map((schema) => ({ name: schema.entityName, ...schema.entitySchema }));
}
