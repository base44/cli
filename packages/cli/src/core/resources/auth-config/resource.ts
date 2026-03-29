import type { Resource } from "../types.js";
import { readAuthConfig } from "./config.js";
import { pushAuthConfig } from "./push.js";
import type { AuthConfig } from "./schema.js";

export const authConfigResource: Resource<AuthConfig> = {
  readAll: async (dir) => {
    const config = await readAuthConfig(dir);
    return config ? [config] : [];
  },
  push: async (items) => {
    await pushAuthConfig(items[0] ?? null);
  },
};
