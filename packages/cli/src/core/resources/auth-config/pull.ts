import { getAuthConfig } from "./api.js";
import type { AuthConfig } from "./schema.js";

/**
 * Pulls the auth config from the remote API.
 */
export async function pullAuthConfig(): Promise<AuthConfig> {
  return await getAuthConfig();
}
