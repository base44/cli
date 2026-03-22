import { pushAuthConfigToApi } from "./api.js";
import type { AuthConfig } from "./schema.js";

/**
 * Pushes the auth config to the remote API.
 * If the array is empty, does nothing.
 */
export async function pushAuthConfig(configs: AuthConfig[]): Promise<void> {
  if (configs.length === 0) {
    return;
  }

  await pushAuthConfigToApi(configs[0]);
}
