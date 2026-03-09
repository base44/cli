import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  DeploySingleFunctionResponse,
  FunctionFile,
  FunctionLogFilters,
  FunctionLogsResponse,
  ListFunctionsResponse,
} from "@/core/resources/function/schema.js";
import {
  DeploySingleFunctionResponseSchema,
  FunctionLogsResponseSchema,
  ListFunctionsResponseSchema,
} from "@/core/resources/function/schema.js";

export async function deploySingleFunction(
  name: string,
  payload: { entry: string; files: FunctionFile[]; automations?: unknown[] },
): Promise<DeploySingleFunctionResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.put(
      `backend-functions/${encodeURIComponent(name)}`,
      { json: payload, timeout: false },
    );
  } catch (error) {
    throw await ApiError.fromHttpError(error, `deploying function "${name}"`);
  }

  const result = DeploySingleFunctionResponseSchema.safeParse(
    await response.json(),
  );
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data;
}

export async function deleteSingleFunction(name: string): Promise<void> {
  const appClient = getAppClient();
  try {
    await appClient.delete(`backend-functions/${encodeURIComponent(name)}`, {
      timeout: 60_000,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, `deleting function "${name}"`);
  }
}

export async function listDeployedFunctions(): Promise<ListFunctionsResponse> {
  const appClient = getAppClient();

  let response: KyResponse;
  try {
    response = await appClient.get("backend-functions", { timeout: 30_000 });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "listing deployed functions");
  }

  const result = ListFunctionsResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data;
}

// ─── FUNCTION LOGS API ──────────────────────────────────────

/**
 * Build query string from filter options.
 */
function buildLogsQueryString(filters: FunctionLogFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.since) {
    params.set("since", filters.since);
  }
  if (filters.until) {
    params.set("until", filters.until);
  }
  if (filters.level) {
    params.set("level", filters.level);
  }
  if (filters.limit !== undefined) {
    params.set("limit", String(filters.limit));
  }
  if (filters.order) {
    params.set("order", filters.order);
  }

  return params;
}

/**
 * Fetch runtime logs for a specific function from Deno Deploy.
 */
export async function fetchFunctionLogs(
  functionName: string,
  filters: FunctionLogFilters = {},
): Promise<FunctionLogsResponse> {
  const appClient = getAppClient();
  const searchParams = buildLogsQueryString(filters);

  let response: KyResponse;
  try {
    response = await appClient.get(`functions-mgmt/${functionName}/logs`, {
      searchParams,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(
      error,
      `fetching function logs: '${functionName}'`,
    );
  }

  const result = FunctionLogsResponseSchema.safeParse(await response.json());

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid function logs response from server",
      result.error,
    );
  }

  return result.data;
}
