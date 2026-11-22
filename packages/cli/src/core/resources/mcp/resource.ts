import type { Resource } from "../types.js";
import { readMcpConfig } from "./config.js";
import { pushMcpConfig } from "./push.js";
import type { McpConfig } from "./schema.js";

/**
 * One file, not a collection: `readAll` returns the config as a single item, or
 * none when the project has no `mcp/config.json`. Its directory is fixed
 * (`<configDir>/mcp`), so callers pass `join(configDir, MCP_DIR)`.
 */
export const mcpConfigResource: Resource<McpConfig> = {
  readAll: async (dir) => {
    const config = await readMcpConfig(dir);
    return config ? [config] : [];
  },
  push: async (items) => await pushMcpConfig(items[0] ?? null),
};
