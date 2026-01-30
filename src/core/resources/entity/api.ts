import { getAppClient, formatApiError } from "@/core/clients/index.js";
import { SyncEntitiesResponseSchema } from "@/core/resources/entity/schema.js";
import type { SyncEntitiesResponse, Entity } from "@/core/resources/entity/schema.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";

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
      throw new ApiError(`Failed to delete entity: ${formatApiError(errorJson)}`, {
        statusCode: response.status,
      });
    }

    throw new ApiError(
      `Error occurred while syncing entities: ${formatApiError(errorJson)}`,
      { statusCode: response.status }
    );
  }

  const result = SyncEntitiesResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError("Invalid response from server", result.error);
  }

  return result.data;
}
