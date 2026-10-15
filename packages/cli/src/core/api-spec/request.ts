import { HTTPError } from "ky";
import { base44Client } from "@/core/clients/index.js";
import { ApiError } from "@/core/errors.js";

const MAX_ERROR_BODY_CHARS = 4000;
const QUERY_STRING = /\?\S*/g;

async function readBody(response: Response): Promise<string | undefined> {
  try {
    const text = (await response.clone().text()).trim();
    return text.length > MAX_ERROR_BODY_CHARS
      ? `${text.slice(0, MAX_ERROR_BODY_CHARS)}…`
      : text || undefined;
  } catch {
    return undefined;
  }
}

export interface ApiResponse {
  status: number;
  contentType: string;
  body: Uint8Array;
}

/** Send a request as is through the authenticated client; the server validates it. */
export async function sendApiRequest(
  method: string,
  path: string,
  body?: string,
): Promise<ApiResponse> {
  try {
    const response = await base44Client(path.replace(/^\/+/, ""), {
      method,
      body,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      // The call may be a long deploy; the built-in commands wait as long.
      timeout: false,
      // Re-sending a write the server may have applied is not safe.
      retry: { methods: ["get", "head"] },
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: new Uint8Array(await response.arrayBuffer()),
    };
  } catch (error) {
    const apiError = await ApiError.fromHttpError(
      error,
      `calling ${method} ${path}`,
    );
    const raw =
      error instanceof HTTPError ? await readBody(error.response) : undefined;
    throw redactedApiError(apiError, raw, method, path);
  }
}

/**
 * The error a failed call reports and shows. Any endpoint can carry secrets,
 * so neither body nor the query string goes to error reporting; the server's
 * raw reply goes to the caller in the details, and the message names only the
 * status so that reply is printed once.
 */
export function redactedApiError(
  apiError: ApiError,
  raw: string | undefined,
  method: string,
  path: string,
): ApiError {
  // Never reuse apiError.message: it holds the path and ky's full URL with
  // the query string. A network error keeps its own words, minus any query.
  const reason =
    apiError.statusCode !== undefined
      ? `HTTP ${apiError.statusCode}`
      : (apiError.cause?.message ?? "request failed").replace(QUERY_STRING, "");
  const message = `Error calling ${method} ${path.split("?", 1)[0]}: ${reason}`;
  return new ApiError(message, {
    statusCode: apiError.statusCode,
    requestUrl: apiError.requestUrl?.split("?", 1)[0],
    requestMethod: apiError.requestMethod,
    requestId: apiError.requestId,
    hints: apiError.hints,
    details: raw ? [`Response body: ${raw}`] : apiError.details,
  });
}
