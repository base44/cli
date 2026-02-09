import type { KyResponse } from "ky";
import { HTTPError } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  Entity,
  SyncEntitiesResponse,
} from "@/core/resources/entity/schema.js";
import { SyncEntitiesResponseSchema } from "@/core/resources/entity/schema.js";

export async function syncEntities(
  entities: Entity[]
): Promise<SyncEntitiesResponse> {
  const appClient = getAppClient();
  const schemaSyncPayload = Object.fromEntries(
    entities.map((entity) => [entity.name, entity])
  );

  let response: KyResponse;
  try {
    response = await appClient.put("entity-schemas", {
      json: {
        entityNameToSchema: schemaSyncPayload,
      },
    });
  } catch (error) {
    // Handle 428 status code specifically (entity has records, can't delete)
    if (error instanceof HTTPError && error.response.status === 428) {
      throw new ApiError("Cannot delete entity that has existing records", {
        statusCode: 428,
        cause: error,
      });
    }

    throw await ApiError.fromHttpError(error, "syncing entities");
  }

  const result = SyncEntitiesResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error
    );
  }

  return result.data;
}
