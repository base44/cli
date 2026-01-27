/**
 * Authenticated HTTP client for Base44 API.
 * Automatically handles token refresh and retry on 401 responses.
 */

import ky from "ky";
import type { KyRequest, KyResponse, NormalizedOptions } from "ky";
import { getBase44ApiUrl } from "@/core/config.js";
import {
  readAuth,
  refreshAndSaveTokens,
  isTokenExpired,
} from "@/core/auth/config.js";
import { getAppConfig } from "@/core/project/index.js";
import { ApiErrorSchema, type ApiErrorResponse } from "./schemas.js";

/**
 * Formats API error responses into human-readable strings.
 * Internal utility used by error handling hooks.
 */
function formatApiError(errorJson: unknown): string {
  const error = errorJson as Partial<ApiErrorResponse> | null;
  const content = error?.message ?? error?.detail ?? errorJson;
  return typeof content === "string" ? content : JSON.stringify(content, null, 2);
}

// Track requests that have already been retried to prevent infinite loops
const retriedRequests = new WeakSet<KyRequest>();

/**
 * Handles 401 responses by refreshing the token and retrying the request.
 * Only retries once per request to prevent infinite loops.
 */
async function handleUnauthorized(
  request: KyRequest,
  _options: NormalizedOptions,
  response: KyResponse
): Promise<Response | void> {
  if (response.status !== 401) {
    return;
  }

  // Prevent infinite retry loop - only retry once per request
  if (retriedRequests.has(request)) {
    return;
  }

  const newAccessToken = await refreshAndSaveTokens();

  if (!newAccessToken) {
    // Refresh failed, let the 401 propagate
    return;
  }

  // Mark this request as retried and retry with new token
  retriedRequests.add(request);
  return ky(request, {
    headers: { Authorization: `Bearer ${newAccessToken}` },
  });
}

/**
 * Handles HTTPErrors by formatting the API error response into a readable message.
 * This hook runs before ky throws the error, allowing us to customize the error message.
 */
async function handleApiErrors(error: Error): Promise<Error> {
  // Only handle HTTPError from ky
  if (error.name !== "HTTPError") {
    return error;
  }

  // Cast to access response property
  const httpError = error as Error & { response?: Response };

  if (!httpError.response) {
    return error;
  }

  // Try to parse the error response body
  try {
    const errorJson: unknown = await httpError.response.clone().json();
    const formattedMessage = formatApiError(errorJson);

    // Create a new error with the formatted message
    const newError = new Error(formattedMessage);
    newError.name = error.name;
    newError.stack = error.stack;

    // Preserve the original response for debugging
    (newError as typeof httpError).response = httpError.response;

    return newError;
  } catch {
    // If we can't parse the body, return the original error
    return error;
  }
}

/**
 * Base44 API client with automatic authentication and error handling.
 * Use this for general API calls that require authentication.
 * All non-OK responses are automatically caught and formatted into Error objects.
 */
export const base44Client = ky.create({
  prefixUrl: getBase44ApiUrl(),
  headers: {
    "User-Agent": "Base44 CLI",
  },
  hooks: {
    beforeRequest: [
      async (request) => {
        try {
          const auth = await readAuth();

          // Proactively refresh if token is expired or about to expire
          if (isTokenExpired(auth)) {
            const newAccessToken = await refreshAndSaveTokens();
            if (newAccessToken) {
              request.headers.set("Authorization", `Bearer ${newAccessToken}`);
              return;
            }
          }

          request.headers.set("Authorization", `Bearer ${auth.accessToken}`);
        } catch {
          // No auth available, continue without header
        }
      },
    ],
    afterResponse: [handleUnauthorized],
    beforeError: [handleApiErrors],
  },
});

/**
 * Returns an HTTP client scoped to the current app.
 * Requires app config to be initialized first via initAppConfig() or setAppConfig().
 * Use this for API calls to app-specific endpoints (entities, functions, etc.).
 *
 * @throws {Error} If app config is not initialized.
 *
 * @example
 * const appClient = getAppClient();
 * const response = await appClient.get("entities");
 */
export function getAppClient() {
  const { id } = getAppConfig();
  return base44Client.extend({
    prefixUrl: new URL(`/api/apps/${id}/`, getBase44ApiUrl()).href,
  });
}
