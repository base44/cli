import ky from "ky";
import {
  isTokenExpired,
  readAuth,
  refreshAndSaveTokens,
} from "@/core/auth/config.js";
import { getAppConfig } from "@/core/project/index.js";
import { getSiteUrl } from "@/core/site/api.js";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

const METHODS_WITH_BODY = new Set<HttpMethod>(["POST", "PUT", "PATCH"]);

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
  options?: {
    timeout?: number;
    method?: string;
    headers?: Record<string, string>;
  },
): Promise<unknown> {
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

  const response = await ky(url, {
    method,
    ...(METHODS_WITH_BODY.has(method) ? { json: data } : {}),
    headers: {
      Authorization: `Bearer ${token}`,
      "X-App-Id": id,
      "User-Agent": "Base44 CLI",
      ...options?.headers,
    },
    timeout: options?.timeout ?? 300_000,
  });

  return response.json();
}
