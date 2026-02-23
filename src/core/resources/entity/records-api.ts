/**
 * API functions for entity record CRUD operations.
 * Communicates with GET/POST/PUT/DELETE /api/apps/{app_id}/entities/{entity_name}
 *
 * Uses a token exchange (platform token → app-user token) to authenticate with
 * the RuntimeRouter, with X-Bypass-RLS to get admin-level access.
 */

import type { KyResponse } from "ky";
import { getAppUserClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import {
  type DeleteRecordResponse,
  DeleteRecordResponseSchema,
  type EntityRecord,
  EntityRecordSchema,
} from "./records-schema.js";

interface ListRecordsOptions {
  filter?: string;
  sort?: string;
  limit?: number;
  skip?: number;
  fields?: string;
}

export async function listRecords(
  entityName: string,
  options: ListRecordsOptions = {},
): Promise<EntityRecord[]> {
  const client = await getAppUserClient();

  const searchParams = new URLSearchParams();
  if (options.filter) {
    searchParams.set("q", options.filter);
  }
  if (options.sort) {
    searchParams.set("sort", options.sort);
  }
  if (options.limit !== undefined) {
    searchParams.set("limit", String(options.limit));
  }
  if (options.skip !== undefined) {
    searchParams.set("skip", String(options.skip));
  }
  if (options.fields) {
    searchParams.set("fields", options.fields);
  }

  let response: KyResponse;
  try {
    response = await client.get(`entities/${entityName}`, {
      searchParams,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "listing records");
  }

  const json = await response.json();

  // Response is an array of records
  const records = Array.isArray(json) ? json : [];
  return records.map((record: unknown) => {
    const result = EntityRecordSchema.safeParse(record);
    if (!result.success) {
      throw new SchemaValidationError(
        "Invalid record in response",
        result.error,
      );
    }
    return result.data;
  });
}

export async function getRecord(
  entityName: string,
  recordId: string,
): Promise<EntityRecord> {
  const client = await getAppUserClient();

  let response: KyResponse;
  try {
    response = await client.get(`entities/${entityName}/${recordId}`);
  } catch (error) {
    throw await ApiError.fromHttpError(error, "getting record");
  }

  const json = await response.json();
  const result = EntityRecordSchema.safeParse(json);
  if (!result.success) {
    throw new SchemaValidationError("Invalid record response", result.error);
  }

  return result.data;
}

export async function createRecord(
  entityName: string,
  data: Record<string, unknown>,
): Promise<EntityRecord> {
  const client = await getAppUserClient();

  let response: KyResponse;
  try {
    response = await client.post(`entities/${entityName}`, {
      json: data,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "creating record");
  }

  const json = await response.json();
  const result = EntityRecordSchema.safeParse(json);
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid record in create response",
      result.error,
    );
  }

  return result.data;
}

export async function updateRecord(
  entityName: string,
  recordId: string,
  data: Record<string, unknown>,
): Promise<EntityRecord> {
  const client = await getAppUserClient();

  let response: KyResponse;
  try {
    response = await client.put(`entities/${entityName}/${recordId}`, {
      json: data,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "updating record");
  }

  const json = await response.json();
  const result = EntityRecordSchema.safeParse(json);
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid record in update response",
      result.error,
    );
  }

  return result.data;
}

export async function deleteRecord(
  entityName: string,
  recordId: string,
): Promise<DeleteRecordResponse> {
  const client = await getAppUserClient();

  let response: KyResponse;
  try {
    response = await client.delete(`entities/${entityName}/${recordId}`);
  } catch (error) {
    throw await ApiError.fromHttpError(error, "deleting record");
  }

  const json = await response.json();
  const result = DeleteRecordResponseSchema.safeParse(json);
  if (!result.success) {
    throw new SchemaValidationError("Invalid delete response", result.error);
  }

  return result.data;
}
