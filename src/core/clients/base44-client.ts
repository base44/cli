/**
 * Authenticated HTTP client for Base44 API.
 * Automatically handles token refresh and retry on 401 responses.
 */

import ky from "ky";
import type { KyRequest, KyResponse, NormalizedOptions } from "ky";
import { getBase44ApiUrl } from "../config.js";
import {
  readAuth,
  refreshAndSaveTokens,
  isTokenExpired,
} from "../auth/config.js";
import { findProjectRoot, getAppId } from "../project/index.js";

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
 * Use this for API calls to app-specific endpoints (entities, functions, etc.).
 *
 * @throws {Error} If .app.jsonc config file is not found or appId is not set.
 *
 * @example
 * const appClient = await getAppClient();
 * const response = await appClient.get("entities");
 */
export async function getAppClient() {
  const projectRoot = await findProjectRoot();

  if (!projectRoot) {
    throw new Error(
      "No Base44 project found. Run this command from a project directory with a config.jsonc file."
    );
  }

  const appId = await getAppId(projectRoot.root);

  if (!appId) {
    throw new Error(
      "App not configured. Create a .app.jsonc file with your appId, or run 'base44 link' to link this project."
    );
  }

  return base44Client.extend({
    prefixUrl: new URL(`/api/apps/${appId}/`, getBase44ApiUrl()).href,
  });
}
