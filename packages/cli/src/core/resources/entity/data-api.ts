import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError } from "@/core/errors.js";

export interface EntityRecord {
  id: string;
  created_date: string;
  updated_date?: string;
  created_by?: string;
  [key: string]: unknown;
}

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

  return (await response.json()) as EntityRecord[];
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

  return (await response.json()) as EntityRecord;
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

  const data = (await response.json()) as { count: number };
  return data.count;
}
