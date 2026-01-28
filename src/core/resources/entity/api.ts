import { getAppClient, formatApiError } from "@/core/clients/index.js";
import { SyncEntitiesResponseSchema } from "@/core/resources/entity/schema.js";
import type { SyncEntitiesResponse, Entity } from "@/core/resources/entity/schema.js";

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
    const errorJson: unknown = await response.json();
    if (response.status === 428) {
      throw new Error(`Failed to delete entity: ${formatApiError(errorJson)}`);
    }

    throw new Error(
      `Error occurred while syncing entities: ${formatApiError(errorJson)}`
    );
  }

  const result = SyncEntitiesResponseSchema.parse(await response.json());

  return result;
}
