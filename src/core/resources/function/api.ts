import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  DeployFunctionsResponse,
  FunctionLogFilters,
  FunctionLogsResponse,
  FunctionWithCode,
} from "@/core/resources/function/schema.js";
import {
  DeployFunctionsResponseSchema,
  FunctionLogsResponseSchema,
} from "@/core/resources/function/schema.js";

function toDeployPayloadItem(fn: FunctionWithCode) {
  return {
    name: fn.name,
    entry: fn.entry,
    files: fn.files,
    automations: fn.automations,
  };
}

export async function deployFunctions(
  functions: FunctionWithCode[],
): Promise<DeployFunctionsResponse> {
  const appClient = getAppClient();
  const payload = {
    functions: functions.map(toDeployPayloadItem),
  };

  let response: KyResponse;
  try {
    response = await appClient.put("backend-functions", {
      json: payload,
      timeout: false,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "deploying functions");
  }

  const result = DeployFunctionsResponseSchema.safeParse(await response.json());

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
