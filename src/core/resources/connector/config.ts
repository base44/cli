import { globby } from "globby";
import { SchemaValidationError } from "@/core/errors.js";
import { CONFIG_FILE_EXTENSION_GLOB } from "../../consts.js";
import { pathExists, readJsonFile } from "../../utils/fs.js";
import type { ConnectorResource } from "./schema.js";
import { ConnectorResourceSchema } from "./schema.js";

async function readConnectorFile(
  connectorPath: string
): Promise<ConnectorResource> {
  const parsed = await readJsonFile(connectorPath);
  const result = ConnectorResourceSchema.safeParse(parsed);

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid connector file",
      result.error,
      connectorPath
    );
  }

  return result.data;
}

/**
 * Read all connector files from a directory.
 * Returns an empty array if the directory doesn't exist.
 */
export async function readAllConnectors(
  connectorsDir: string
): Promise<ConnectorResource[]> {
  if (!(await pathExists(connectorsDir))) {
    return [];
  }

  const files = await globby(`*.${CONFIG_FILE_EXTENSION_GLOB}`, {
    cwd: connectorsDir,
    absolute: true,
  });

  const connectors = await Promise.all(
    files.map((filePath) => readConnectorFile(filePath))
  );

  const types = new Set<string>();
  for (const connector of connectors) {
    if (types.has(connector.type)) {
      throw new Error(`Duplicate connector type "${connector.type}"`);
    }
    types.add(connector.type);
  }

  return connectors;
}
