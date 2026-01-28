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
import type { ApiErrorResponse } from "./schemas.js";

export function formatApiError(errorJson: unknown): string {
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
 * Base44 API client with automatic authentication.
 * Use this for general API calls that require authentication.
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
