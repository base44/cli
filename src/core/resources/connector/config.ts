import { join } from "node:path";
import { globby } from "globby";
import { InvalidInputError, SchemaValidationError } from "@/core/errors.js";
import {
  CONFIG_FILE_EXTENSION,
  CONFIG_FILE_EXTENSION_GLOB,
} from "../../consts.js";
import {
  deleteFile,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../../utils/fs.js";
import type { ConnectorResource, UpstreamConnector } from "./schema.js";
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

/**
 * Write connectors to local files, removing any that aren't in the remote list.
 * Returns information about which files were written and deleted.
 */
export async function writeConnectors(
  connectorsDir: string,
  remoteConnectors: UpstreamConnector[]
): Promise<{ written: string[]; deleted: string[] }> {
  const existingConnectors = await readAllConnectors(connectorsDir);
  const newTypes = new Set(remoteConnectors.map((c) => c.integration_type));

  // Delete local connectors that don't exist remotely
  const toDelete = existingConnectors.filter((c) => !newTypes.has(c.type));
  for (const connector of toDelete) {
    const files = await globby(
      `${connector.type}.${CONFIG_FILE_EXTENSION_GLOB}`,
      {
        cwd: connectorsDir,
        absolute: true,
      }
    );
    for (const filePath of files) {
      await deleteFile(filePath);
    }
  }

  // Write all remote connectors to files
  for (const connector of remoteConnectors) {
    const filePath = join(
      connectorsDir,
      `${connector.integration_type}.${CONFIG_FILE_EXTENSION}`
    );
    const localConnector: ConnectorResource = {
      type: connector.integration_type,
      scopes: connector.scopes,
    };
    await writeJsonFile(filePath, localConnector);
  }

  const written = remoteConnectors.map((c) => c.integration_type);
  const deleted = toDelete.map((c) => c.type);

  return { written, deleted };
}
