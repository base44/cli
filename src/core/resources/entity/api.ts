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
  });

  const result = SyncEntitiesResponseSchema.parse(await response.json());

  return result;
}
