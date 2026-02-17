/**
 * API functions for entity record CRUD operations.
 * Communicates with GET/POST/PUT/DELETE /api/apps/{app_id}/admin/entities/{entity_name}
 *
 * Uses the admin entities router which authenticates via AppAdminRouter (builder/platform auth)
 * and automatically bypasses RLS.
 */

import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import {
  DeleteRecordResponseSchema,
  EntityRecordSchema,
  type DeleteRecordResponse,
  type EntityRecord,
} from "./records-schema.js";

export interface ListRecordsOptions {
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
  const appClient = getAppClient();

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

  let response;
  try {
    response = await appClient.get(`admin/entities/${entityName}`, {
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
  const appClient = getAppClient();

  let response;
  try {
    response = await appClient.get(`admin/entities/${entityName}/${recordId}`);
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
  const appClient = getAppClient();

  let response;
  try {
    response = await appClient.post(`admin/entities/${entityName}`, {
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
  const appClient = getAppClient();

  let response;
  try {
    response = await appClient.put(`admin/entities/${entityName}/${recordId}`, {
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
  const appClient = getAppClient();

  let response;
  try {
    response = await appClient.delete(`admin/entities/${entityName}/${recordId}`);
  } catch (error) {
    throw await ApiError.fromHttpError(error, "deleting record");
  }

  const json = await response.json();
  const result = DeleteRecordResponseSchema.safeParse(json);
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid delete response",
      result.error,
    );
  }

  return result.data;
}
