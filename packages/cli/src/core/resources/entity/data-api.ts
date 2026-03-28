import type { KyResponse } from "ky";
import { z } from "zod";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";

const EntityRecordSchema = z
  .object({
    id: z.string(),
    created_date: z.string(),
  })
  .passthrough();

const EntityRecordListSchema = z.array(EntityRecordSchema);

const CountResponseSchema = z.object({
  count: z.number(),
});

export type EntityRecord = z.infer<typeof EntityRecordSchema>;

export interface ListEntityRecordsOptions {
  limit?: number;
  skip?: number;
  sort?: string;
}

export async function listEntityRecords(
  entityName: string,
  options: ListEntityRecordsOptions = {},
): Promise<EntityRecord[]> {
  const appClient = getAppClient();
  const searchParams = new URLSearchParams();

  if (options.limit !== undefined) {
    searchParams.set("limit", String(options.limit));
  }
  if (options.skip !== undefined) {
    searchParams.set("skip", String(options.skip));
  }
  if (options.sort) {
    searchParams.set("sort", options.sort);
  }

  let response: KyResponse;
  try {
    response = await appClient.get(
      `entities/${encodeURIComponent(entityName)}`,
      { searchParams, timeout: 30_000 },
    );
  } catch (error) {
    throw await ApiError.fromHttpError(
      error,
      `listing records for entity "${entityName}"`,
    );
  }

  const result = EntityRecordListSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data;
}

export async function getEntityRecord(
  entityName: string,
  id: string,
): Promise<EntityRecord> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.get(
      `entities/${encodeURIComponent(entityName)}/${encodeURIComponent(id)}`,
      { timeout: 30_000 },
    );
  } catch (error) {
    throw await ApiError.fromHttpError(
      error,
      `fetching record "${id}" from entity "${entityName}"`,
    );
  }

  const result = EntityRecordSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data;
}

export async function countEntityRecords(
  entityName: string,
): Promise<number> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.get(
      `entities/${encodeURIComponent(entityName)}/count`,
      { timeout: 30_000 },
    );
  } catch (error) {
    throw await ApiError.fromHttpError(
      error,
      `counting records for entity "${entityName}"`,
    );
  }

  const result = CountResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data.count;
}
