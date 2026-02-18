import type { KyResponse } from "ky";
import ky from "ky";
import {
  isTokenExpired,
  readAuth,
  refreshAndSaveTokens,
} from "@/core/auth/config.js";
import { ApiError } from "@/core/errors.js";
import { getAppConfig } from "@/core/project/index.js";
import { getSiteUrl } from "@/core/site/api.js";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

const METHODS_WITH_BODY = new Set<HttpMethod>(["POST", "PUT", "PATCH"]);

interface InvokeFunctionResult {
  /** The function's response body */
  body: unknown;
  /** HTTP status code */
  status: number;
  /** HTTP status text */
  statusText: string;
  /** Response headers */
  headers: Record<string, string>;
  /** Request URL */
  url: string;
  /** Request method */
  method: string;
  /** Request headers that were sent */
  requestHeaders: Record<string, string>;
  /** Time taken in milliseconds */
  durationMs: number;
}

/**
 * Invokes a deployed backend function by name.
 *
 * @param functionName - The name of the function to invoke
 * @param data - JSON-serializable data to pass to the function
 * @param options - Optional configuration for the invocation
 * @returns The function's response data and metadata
 */
export async function invokeFunction(
  functionName: string,
  data: Record<string, unknown>,
  options?: {
    timeout?: number;
    method?: string;
    headers?: Record<string, string>;
  },
): Promise<InvokeFunctionResult> {
  const { id } = getAppConfig();
  const method = (options?.method?.toUpperCase() ?? "POST") as HttpMethod;

  // Resolve the app's published URL (e.g. https://my-app.base44.app)
  const siteUrl = await getSiteUrl();
  const url = `${siteUrl.replace(/\/+$/, "")}/api/functions/${functionName}`;

  // Get a valid access token
  const auth = await readAuth();
  let token = auth.accessToken;
  if (isTokenExpired(auth)) {
    const refreshed = await refreshAndSaveTokens();
    if (refreshed) {
      token = refreshed;
    }
  }

  const requestHeaders = {
    Authorization: `Bearer ${token}`,
    "X-App-Id": id,
    "User-Agent": "Base44 CLI",
    ...options?.headers,
  };

  const startTime = Date.now();
  let response: KyResponse;
  try {
    response = await ky(url, {
      method,
      ...(METHODS_WITH_BODY.has(method) ? { json: data } : {}),
      headers: requestHeaders,
      timeout: options?.timeout ?? 300_000,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "invoking function");
  }
  const durationMs = Date.now() - startTime;

  // Extract response headers
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  const body = await response.json();

  return {
    body,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    url,
    method,
    requestHeaders,
    durationMs,
  };
}
