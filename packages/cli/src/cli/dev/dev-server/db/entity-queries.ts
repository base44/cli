import type Datastore from "@seald-io/nedb";
import type { ParsedQs } from "qs";
import { InvalidInputError } from "@/core/errors.js";

/**
 * Parse sort string into NeDB sort object.
 * "-field" → { field: -1 } (descending)
 * "field" → { field: 1 } (ascending)
 */
function parseSort(
  sort: string | undefined,
): Record<string, 1 | -1> | undefined {
  if (!sort) {
    return undefined;
  }

  if (sort.startsWith("-")) {
    return { [sort.slice(1)]: -1 };
  }
  return { [sort]: 1 };
}

/**
 * Parse fields string into NeDB projection object.
 * "a,b,c" → { a: 1, b: 1, c: 1 }
 */
function parseFields(
  fields: string | undefined,
): Record<string, 1> | undefined {
  if (!fields) {
    return undefined;
  }

  const projection: Record<string, 1> = {};
  for (const field of fields.split(",")) {
    const trimmed = field.trim();
    if (trimmed) {
      projection[trimmed] = 1;
    }
  }
  return Object.keys(projection).length > 0 ? projection : undefined;
}

export const queryEntity = async (
  collection: Datastore,
  reqQuery: ParsedQs,
) => {
  const { sort, limit, skip, fields, q } = reqQuery;

  let query = {};
  if (q && typeof q === "string") {
    try {
      query = JSON.parse(q);
    } catch {
      throw new InvalidInputError("Invalid query parameter 'q'");
    }
  }

  let cursor = collection.findAsync(query);

  const sortObj = parseSort(sort as string | undefined);
  if (sortObj) {
    cursor = cursor.sort(sortObj);
  }

  if (skip) {
    const skipNum = Number.parseInt(skip as string, 10);
    if (!Number.isNaN(skipNum)) {
      cursor = cursor.skip(skipNum);
    }
  }

  if (limit) {
    const limitNum = Number.parseInt(limit as string, 10);
    if (!Number.isNaN(limitNum)) {
      cursor = cursor.limit(limitNum);
    }
  }

  const projection = parseFields(fields as string | undefined);
  if (projection) {
    cursor = cursor.projection(projection);
  }

  return cursor;
};
