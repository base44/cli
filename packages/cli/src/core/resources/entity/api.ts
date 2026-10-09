import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  Entity,
  SyncEntitiesResponse,
} from "@/core/resources/entity/schema.js";
import { SyncEntitiesResponseSchema } from "@/core/resources/entity/schema.js";

/** Read the remote entity catalog without touching records or mutating resources. */
export async function listEntitySchemas(): Promise<unknown> {
  const appClient = getAppClient();
  try {
    const response = await appClient.get("entity-schemas");
    return await response.json();
  } catch (error) {
    throw await ApiError.fromHttpError(error, "listing entity schemas");
  }
}

export async function syncEntities(
  entities: Entity[],
): Promise<SyncEntitiesResponse> {
  const appClient = getAppClient();
  const schemaSyncPayload = Object.fromEntries(
    entities.map(({ source: _source, ...entity }) => [entity.name, entity]),
  );

  let response: KyResponse;
  try {
    response = await appClient.put("entity-schemas", {
      json: {
        entityNameToSchema: schemaSyncPayload,
      },
      timeout: 60_000,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "syncing entities");
  }

  const result = SyncEntitiesResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }

  return result.data;
}
