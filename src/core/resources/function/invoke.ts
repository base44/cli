import ky from "ky";
import {
  isTokenExpired,
  readAuth,
  refreshAndSaveTokens,
} from "@/core/auth/config.js";
import { getAppConfig } from "@/core/project/index.js";

// Function invocation must go through the app domain (base44.app),
// not the platform domain (app.base44.com).
const APP_DOMAIN_BASE_URL =
  process.env.BASE44_APP_URL || "https://base44.app";

/**
 * Invokes a deployed backend function by name.
 *
 * @param functionName - The name of the function to invoke
 * @param data - JSON-serializable data to pass to the function
 * @param options - Optional configuration for the invocation
 * @returns The function's response data
 */
export async function invokeFunction(
  functionName: string,
  data: Record<string, unknown>,
  options?: { timeout?: number },
): Promise<unknown> {
  const { id } = getAppConfig();

  // Get a valid access token
  const auth = await readAuth();
  let token = auth.accessToken;
  if (isTokenExpired(auth)) {
    const refreshed = await refreshAndSaveTokens();
    if (refreshed) {
      token = refreshed;
    }
  }

  const response = await ky.post(
    `${APP_DOMAIN_BASE_URL}/api/apps/${id}/functions/${functionName}`,
    {
      json: data,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-App-Id": id,
        "User-Agent": "Base44 CLI",
      },
      timeout: options?.timeout ?? 300_000,
    },
  );

  return response.json();
}
