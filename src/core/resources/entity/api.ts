import { getAppClient } from "@/core/clients/index.js";
import { SyncEntitiesResponseSchema } from "@/core/resources/entity/schema.js";
import type { SyncEntitiesResponse, Entity } from "@/core/resources/entity/schema.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import { HTTPError } from "ky";

export async function syncEntities(
  entities: Entity[]
): Promise<SyncEntitiesResponse> {
  const appClient = getAppClient();
  const schemaSyncPayload = Object.fromEntries(
    entities.map((entity) => [entity.name, entity])
  );

  let response;
  try {
    response = await appClient.put("entity-schemas", {
      json: {
        entityNameToSchema: schemaSyncPayload,
      },
    });
  } catch (error) {
    // Handle 428 status code specifically
    if (error instanceof HTTPError && error.response.status === 428) {
      throw new ApiError(
        `Failed to delete entity: ${error instanceof Error ? error.message : String(error)}`,
        { statusCode: 428 }
      );
    }

    throw new ApiError(
      `Error occurred while syncing entities: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const result = SyncEntitiesResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError("Invalid response from server", result.error);
  }

  return result.data;
}
