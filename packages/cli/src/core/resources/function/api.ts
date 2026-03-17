import type { KyResponse } from "ky";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  DeploySingleFunctionResponse,
  FunctionFile,
  FunctionLogEntry,
  FunctionLogFilters,
  FunctionLogsResponse,
  ListFunctionsResponse,
  StreamLogFilters,
} from "@/core/resources/function/schema.js";
import {
  DeploySingleFunctionResponseSchema,
  FunctionLogEntrySchema,
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

/**
 * Build query string for stream filter options.
 */
function buildStreamQueryString(filters: StreamLogFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.level) {
    params.set("level", filters.level);
  }
  return params;
}

/**
 * Stream real-time logs for a specific function via SSE.
 *
 * Uses getAppClient() (ky) with timeout: false to preserve token refresh,
 * 401 retry, and ApiError mapping. Reads the response body as a ReadableStream
 * and parses SSE data: lines into typed log entries.
 *
 * IMPORTANT: Do NOT call response.json() or response.text() — those buffer
 * the entire body. Only read from response.body incrementally.
 */
export async function* streamFunctionLogs(
  functionName: string,
  filters: StreamLogFilters = {},
  signal?: AbortSignal,
): AsyncGenerator<FunctionLogEntry> {
  const appClient = getAppClient();
  const searchParams = buildStreamQueryString(filters);

  let response: KyResponse;
  try {
    response = await appClient.get(
      `functions-mgmt/${encodeURIComponent(functionName)}/logs/stream`,
      {
        searchParams,
        timeout: false,
        signal,
      },
    );
  } catch (error) {
    throw await ApiError.fromHttpError(
      error,
      `streaming function logs: '${functionName}'`,
    );
  }

  if (!response.body) {
    throw new ApiError("Server returned empty response for log stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      for (
        let newlineIndex = buffer.indexOf("\n");
        newlineIndex !== -1;
        newlineIndex = buffer.indexOf("\n")
      ) {
        const line = buffer.slice(0, newlineIndex).trimEnd();
        buffer = buffer.slice(newlineIndex + 1);

        // Skip empty lines (SSE event delimiters) and comments (heartbeats)
        if (line === "" || line.startsWith(":")) {
          continue;
        }

        // Parse SSE data: lines
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6); // Remove "data: " prefix
          try {
            const parsed = FunctionLogEntrySchema.safeParse(
              JSON.parse(jsonStr),
            );
            if (parsed.success) {
              yield parsed.data;
            }
          } catch {
            // Malformed JSON — skip this line silently.
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
