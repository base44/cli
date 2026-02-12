import { globby } from "globby";
import { InvalidInputError, SchemaValidationError } from "@/core/errors.js";
import { CONFIG_FILE_EXTENSION_GLOB } from "../../consts.js";
import { pathExists, readJsonFile } from "../../utils/fs.js";
import type { ConnectorResource } from "./schema.js";
import { ConnectorResourceSchema } from "./schema.js";

async function readConnectorFile(
  connectorPath: string,
): Promise<ConnectorResource> {
  const parsed = await readJsonFile(connectorPath);
  const result = ConnectorResourceSchema.safeParse(parsed);

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid connector file",
      result.error,
      connectorPath,
    );
  }

  return result.data;
}

export async function readAllConnectors(
  connectorsDir: string,
): Promise<ConnectorResource[]> {
  if (!(await pathExists(connectorsDir))) {
    return [];
  }

  const files = await globby(`*.${CONFIG_FILE_EXTENSION_GLOB}`, {
    cwd: connectorsDir,
    absolute: true,
  });

  const connectors = await Promise.all(
    files.map((filePath) => readConnectorFile(filePath)),
  );

  assertNoDuplicateConnectors(connectors);

  return connectors;
}

function assertNoDuplicateConnectors(connectors: ConnectorResource[]): void {
  const types = new Set<string>();
  for (const connector of connectors) {
    if (types.has(connector.type)) {
      throw new InvalidInputError(
        `Duplicate connector type "${connector.type}"`,
        {
          hints: [
            {
              message: `Remove duplicate connectors with type "${connector.type}" - only one connector per type is allowed`,
            },
          ],
        },
      );
    }
    types.add(connector.type);
  }
}
