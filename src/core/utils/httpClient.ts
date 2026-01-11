import ky from "ky";
import type { KyRequest, KyResponse, NormalizedOptions } from "ky";
import { getAppId, getBase44ApiUrl } from "../consts.js";
import {
  readAuth,
  refreshAndSaveTokens,
  isTokenExpired,
} from "../auth/config.js";

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

const base44Client = ky.create({
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
 */
function getAppClient() {
  return base44Client.extend({
    prefixUrl: new URL(`/api/apps/${getAppId()}/`, getBase44ApiUrl()).href,
  });
}

export { base44Client, getAppClient };
