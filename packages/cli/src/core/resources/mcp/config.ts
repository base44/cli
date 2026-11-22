import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ConfigInvalidError, SchemaValidationError } from "@/core/errors.js";
import { pathExists, readTextFile, writeFile } from "../../utils/fs.js";
import { type McpConfig, McpConfigSchema } from "./schema.js";

/**
 * Where the MCP config lives, under the project's config directory. Fixed, not
 * configurable: the platform reads the same path from an app's source.
 */
export const MCP_DIR = "mcp";
const MCP_CONFIG_FILENAME = "config.json";

export function getMcpConfigPath(mcpDir: string): string {
  return join(mcpDir, MCP_CONFIG_FILENAME);
}

/**
 * Parses the file as strict JSON. Not JSON5 like the other resource files: the
 * platform parses it strictly, so a comment or trailing comma that JSON5 would
 * accept is a config the platform rejects.
 */
function parseStrictJson(text: string, filePath: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ConfigInvalidError(
      `File contains invalid JSON: ${filePath} (${error instanceof Error ? error.message : String(error)}). The MCP config is read as strict JSON: no comments or trailing commas.`,
      filePath,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

/**
 * Reads `<mcpDir>/config.json`. Returns null when the file doesn't exist.
 */
export async function readMcpConfig(mcpDir: string): Promise<McpConfig | null> {
  const filePath = getMcpConfigPath(mcpDir);
  if (!(await pathExists(filePath))) {
    return null;
  }

  const parsed = parseStrictJson(await readTextFile(filePath), filePath);
  const result = McpConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid MCP config file: expected a JSON object",
      result.error,
      filePath,
    );
  }
  return result.data;
}

/**
 * Writes the MCP config as strict JSON. Skips when the file already holds the
 * same config.
 */
export async function writeMcpConfig(
  mcpDir: string,
  config: McpConfig,
): Promise<{ written: boolean; path: string }> {
  const filePath = getMcpConfigPath(mcpDir);

  if (await pathExists(filePath)) {
    try {
      const existing = JSON.parse(await readTextFile(filePath));
      if (isDeepStrictEqual(existing, config)) {
        return { written: false, path: filePath };
      }
    } catch {
      // An unreadable local file is replaced by the remote one.
    }
  }

  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`);
  return { written: true, path: filePath };
}
