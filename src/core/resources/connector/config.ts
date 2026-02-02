import { basename, extname } from "node:path";
import { globby } from "globby";
import { CONFIG_FILE_EXTENSION_GLOB } from "@/core/consts.js";
import { InvalidInputError, SchemaValidationError } from "@/core/errors.js";
import type { ConnectorResource } from "@/core/resources/connector/schema.js";
import { ConnectorResourceSchema } from "@/core/resources/connector/schema.js";
import { pathExists, readJsonFile } from "@/core/utils/fs.js";

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

  // Validate that filename matches the type
  const fileName = basename(connectorPath, extname(connectorPath));
  if (fileName !== result.data.type) {
    throw new InvalidInputError(
      `Connector file name "${fileName}" does not match type "${result.data.type}" in ${connectorPath}`
    );
  }

  return result.data;
}

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

  return connectors;
}
