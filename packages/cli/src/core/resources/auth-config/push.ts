import { pushAuthConfigToApi } from "./api.js";
import type { AuthConfig } from "./schema.js";

/**
 * Pushes the auth config to the remote API.
 * If null, does nothing.
 */
export async function pushAuthConfig(config: AuthConfig | null): Promise<void> {
  if (!config) {
    return;
  }

  await pushAuthConfigToApi(config);
}
