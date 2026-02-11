/**
 * Authenticated HTTP client for Base44 API.
 * Automatically handles token refresh and retry on 401 responses.
 */

import type { KyRequest, KyResponse, NormalizedOptions } from "ky";
import ky from "ky";
import {
  isTokenExpired,
  readAuth,
  refreshAndSaveTokens,
} from "@/core/auth/config.js";
import { getBase44ApiUrl } from "@/core/config.js";
import { getAppConfig } from "@/core/project/index.js";

// Track requests that have already been retried to prevent infinite loops
const retriedRequests = new WeakSet<KyRequest>();

/**
 * Captures request body for error reporting. Clones the request and reads the
 * clone's body so the original is not consumed. Body is stored in options.context.__requestBody
 * so it is available on HTTPError.options when ApiError.fromHttpError runs (for telemetry).
 */
async function captureRequestBody(
  request: KyRequest,
  options: NormalizedOptions,
): Promise<void> {
  if (request.body == null) {
    return;
  }
  try {
    const cloned = request.clone();
    const text = await cloned.text();
    options.context.__requestBody = text;
  } catch {
    // Ignore capture failures; request will still succeed
  }
}

/**
 * Handles 401 responses by refreshing the token and retrying the request.
 * Only retries once per request to prevent infinite loops.
 */
async function handleUnauthorized(
  request: KyRequest,
  _options: NormalizedOptions,
  response: KyResponse,
): Promise<Response | undefined> {
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
 * Base44 API client with automatic authentication and error handling.
 * Use this for general API calls that require authentication.
 *
 * Note: HTTP errors are thrown as ky's HTTPError. Use ApiError.fromHttpError()
 * in API functions to convert them to structured ApiError instances.
 */
export const base44Client = ky.create({
  prefixUrl: getBase44ApiUrl(),
  headers: {
    "User-Agent": "Base44 CLI",
  },
  hooks: {
    beforeRequest: [
      captureRequestBody,
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
