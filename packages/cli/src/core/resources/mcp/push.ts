import { putMcpConfig } from "./api.js";
import type { McpConfig, McpConfigState } from "./schema.js";

/**
 * Pushes the local MCP config. A missing file pushes nothing: taking the server
 * down is {@link removeMcpConfig}, never the absence of a file.
 */
export async function pushMcpConfig(
  config: McpConfig | null,
): Promise<McpConfigState | null> {
  if (!config) {
    return null;
  }
  return await putMcpConfig(config);
}

/**
 * Deletes the app's MCP config and takes its MCP server down.
 */
export async function removeMcpConfig(): Promise<McpConfigState> {
  return await putMcpConfig(null);
}
