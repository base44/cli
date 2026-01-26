import { writeJsonFile } from "@core/utils/fs.js";
import { getEntities, syncEntities } from "./api.js";
import type { Entity, SyncEntitiesResponse } from "./schema.js";
import { join } from "node:path";

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
