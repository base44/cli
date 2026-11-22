import { getMcpConfig } from "./api.js";
import type { McpConfigState } from "./schema.js";

/**
 * Pulls the app's MCP config and resolved surface from the platform.
 */
export async function pullMcpConfig(): Promise<McpConfigState> {
  return await getMcpConfig();
}
