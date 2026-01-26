import { join } from "node:path";
import { writeJsonFile } from "@core/utils/fs.js";
import { getAppClient } from "@core/clients/index.js";
import { SyncEntitiesResponseSchema } from "./schema.js";
import type { SyncEntitiesResponse, Entity } from "./schema.js";

export async function syncEntities(
  entities: Entity[]
): Promise<SyncEntitiesResponse> {
  const appClient = getAppClient();
  const schemaSyncPayload = Object.fromEntries(
    entities.map((entity) => [entity.name, entity])
  );

  const response = await appClient.put("entity-schemas", {
    json: {
      entityNameToSchema: schemaSyncPayload,
    },
    throwHttpErrors: false,
  });

  if (!response.ok) {
    const errorJson: { message: string } = await response.json();
    if (response.status === 428) {
      throw new Error(`Failed to delete entity: ${errorJson.message}`);
    }

    throw new Error(
      `Error occurred while syncing entities ${errorJson.message}`
    );
  }

  const result = SyncEntitiesResponseSchema.parse(await response.json());

  return result;
}

export async function pullEntities(destPath: string): Promise<any> {
  const appClient = getAppClient();
  const response = await appClient.get("entities-schemas");
  const result = await response.json() as { schemas: { entity_name: string, schema: any }[] };

  result.schemas.forEach((entity) => {
    writeJsonFile(join(destPath, 'base44', 'entities', `${entity.entity_name}.json`), entity.schema);
  });

  return result;
};
