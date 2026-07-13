import type { KyResponse } from "ky";
import { z } from "zod";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";

const EntityRecordsResponseSchema = z.array(z.record(z.string(), z.unknown()));

export type RemoteEntityRecord = Record<string, unknown>;

export type DataEnv = "prod" | "dev";

/** Runtime entities API page size for `data pull`. */
const PAGE_SIZE = 500;

export interface FetchEntityRecordsOptions {
  /** Data environment to read from; `dev` sends the `X-Data-Env: dev` header. */
  dataEnv?: DataEnv;
  /** Filter forwarded as the `q` query param (JSON). */
  query?: Record<string, unknown>;
  /** Maximum number of records to fetch. */
  limit: number;
}

export interface FetchEntityRecordsResult {
  records: RemoteEntityRecord[];
  /**
   * True when pagination stopped at `limit` with a full last page — more
   * records may exist on the server.
   */
  limitReached: boolean;
}

/**
 * Page through `GET apps/:appId/entities/:entityName` (limit/skip params,
 * page size 500) until `limit` records are collected or the server runs out.
 * Records are returned exactly as the API serves them (ids, created_by,
 * created_date preserved).
 */
export async function fetchEntityRecords(
  entityName: string,
  options: FetchEntityRecordsOptions,
): Promise<FetchEntityRecordsResult> {
  const client =
    options.dataEnv === "dev"
      ? getAppClient().extend({ headers: { "X-Data-Env": "dev" } })
      : getAppClient();

  const records: RemoteEntityRecord[] = [];
  while (records.length < options.limit) {
    const pageLimit = Math.min(PAGE_SIZE, options.limit - records.length);
    const searchParams: Record<string, string | number> = {
      limit: pageLimit,
      skip: records.length,
    };
    if (options.query) {
      searchParams.q = JSON.stringify(options.query);
    }

    let response: KyResponse;
    try {
      response = await client.get(
        `entities/${encodeURIComponent(entityName)}`,
        {
          searchParams,
        },
      );
    } catch (error) {
      throw await ApiError.fromHttpError(
        error,
        `pulling records for entity "${entityName}"`,
      );
    }

    const result = EntityRecordsResponseSchema.safeParse(await response.json());
    if (!result.success) {
      throw new SchemaValidationError(
        `Invalid records response for entity "${entityName}"`,
        result.error,
      );
    }

    records.push(...result.data);
    if (result.data.length < pageLimit) {
      return { records, limitReached: false };
    }
  }

  return { records, limitReached: true };
}
