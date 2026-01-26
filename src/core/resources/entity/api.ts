import { join } from "node:path";
import { writeJsonFile } from "@core/utils/fs.js";
import { getAppClient } from "@core/clients/index.js";
import { GetEntitiesResponseSchema, SyncEntitiesResponseSchema } from "./schema.js";
import type { SyncEntitiesResponse, Entity, GetEntitiesResponse } from "./schema.js";

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

export async function getEntities(): Promise<GetEntitiesResponse> {
  const appClient = getAppClient();
  const response = await appClient.get("entity-schemas");
  const data = await response.json();
  
  const result = GetEntitiesResponseSchema.parse(data);

  return result;
};
