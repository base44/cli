import { getAppClient } from "@core/clients/index.js";
import { SyncEntitiesResponseSchema } from "./schema.js";
import type { SyncEntitiesResponse, Entity } from "./schema.js";

export async function pushEntities(
  entities: Entity[]
): Promise<SyncEntitiesResponse> {
  const appClient = getAppClient();
  const schemaSyncPayload = Object.fromEntries(
    entities.map((entity) => [entity.name, entity])
  );

  const response = await appClient.put("entities-schemas/sync-all", {
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
