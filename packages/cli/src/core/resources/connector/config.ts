import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
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

interface ConnectorFileEntry {
  data: ConnectorResource;
  filePath: string;
}

async function readConnectorFiles(
  connectorsDir: string,
): Promise<ConnectorFileEntry[]> {
  if (!(await pathExists(connectorsDir))) {
    return [];
  }

  const files = await globby(`*.${CONFIG_FILE_EXTENSION_GLOB}`, {
    cwd: connectorsDir,
    absolute: true,
  });

  return await Promise.all(
    files.map(async (filePath) => ({
      data: await readConnectorFile(filePath),
      filePath,
    })),
  );
}

function buildTypeToEntryMap(
  entries: ConnectorFileEntry[],
): Map<string, ConnectorFileEntry> {
  const typeToEntry = new Map<string, ConnectorFileEntry>();
  for (const entry of entries) {
    if (typeToEntry.has(entry.data.type)) {
      throw new InvalidInputError(
        `Duplicate connector type "${entry.data.type}"`,
        {
          hints: [
            {
              message: `Remove duplicate connectors with type "${entry.data.type}" - only one connector per type is allowed`,
            },
          ],
        },
      );
    }
    typeToEntry.set(entry.data.type, entry);
  }
  return typeToEntry;
}

export async function readAllConnectors(
  connectorsDir: string,
): Promise<ConnectorResource[]> {
  const entries = await readConnectorFiles(connectorsDir);
  const typeToEntry = buildTypeToEntryMap(entries);
  return [...typeToEntry.values()].map((e) => e.data);
}

export async function writeConnectors(
  connectorsDir: string,
  remoteConnectors: { integrationType: string; scopes: string[] }[],
): Promise<{ written: string[]; deleted: string[] }> {
  const entries = await readConnectorFiles(connectorsDir);
  const typeToEntry = buildTypeToEntryMap(entries);

  const newTypes = new Set(remoteConnectors.map((c) => c.integrationType));

  const deleted: string[] = [];
  for (const [type, entry] of typeToEntry) {
    if (!newTypes.has(type)) {
      await deleteFile(entry.filePath);
      deleted.push(type);
    }
  }

  const written: string[] = [];
  for (const connector of remoteConnectors) {
    const existing = typeToEntry.get(connector.integrationType);
    const localConnector: ConnectorResource = {
      type: connector.integrationType,
      scopes: connector.scopes,
    };

    if (existing && isDeepStrictEqual(existing.data, localConnector)) {
      continue;
    }

    const filePath =
      existing?.filePath ??
      join(
        connectorsDir,
        `${connector.integrationType}.${CONFIG_FILE_EXTENSION}`,
      );
    await writeJsonFile(filePath, localConnector);
    written.push(connector.integrationType);
  }

  return { written, deleted };
}
