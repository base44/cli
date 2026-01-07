import ky from "ky";
import type { KyRequest, KyResponse, NormalizedOptions } from "ky";
import { getBase44ApiUrl } from "../consts.js";
import { readAuth, refreshAndSaveTokens } from "../auth/config.js";

/**
 * Handles 401 responses by refreshing the token and retrying the request.
 */
async function handleUnauthorized(
  request: KyRequest,
  _options: NormalizedOptions,
  response: KyResponse
): Promise<Response | void> {
  if (response.status !== 401) {
    return;
  }

  const newAccessToken = await refreshAndSaveTokens();

  if (!newAccessToken) {
    // Refresh failed, let the 401 propagate
    return;
  }

  // Retry the request with new token
  request.headers.set("Authorization", `Bearer ${newAccessToken}`);
  return ky(request);
}

const httpClient = ky.create({
  prefixUrl: getBase44ApiUrl(),
  headers: {
    "User-Agent": "Base44 CLI",
  },
  hooks: {
    beforeRequest: [
      async (request) => {
        try {
          const auth = await readAuth();
          request.headers.set("Authorization", `Bearer ${auth.accessToken}`);
        } catch {
          // No auth available, continue without header
        }
      },
    ],
    afterResponse: [handleUnauthorized],
  },
});

export default httpClient;
