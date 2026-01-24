import { join } from "node:path";
import { globby } from "globby";
import { z } from "zod";
import { readJsonFile, writeJsonFile } from "../utils/fs.js";
import { PROJECT_SUBDIR, CONFIG_FILE_EXTENSION_GLOB } from "../consts.js";
import { isValidIntegration } from "./constants.js";
import type { IntegrationType } from "./constants.js";

/**
 * Schema for a single connector configuration
 */
export const ConnectorConfigSchema = z.object({
  scopes: z.array(z.string()).optional(),
});

export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;

/**
 * Schema for the connectors.jsonc file
 */
export const ConnectorsFileSchema = z.record(z.string(), ConnectorConfigSchema);

export type ConnectorsFile = z.infer<typeof ConnectorsFileSchema>;

/**
 * Parsed connector with its type
 */
export interface LocalConnector {
  type: IntegrationType;
  scopes?: string[];
}

const CONNECTORS_FILE_PATTERNS = [
  `${PROJECT_SUBDIR}/connectors.${CONFIG_FILE_EXTENSION_GLOB}`,
  `connectors.${CONFIG_FILE_EXTENSION_GLOB}`,
];

/**
 * Find the connectors config file in the project
 */
export async function findConnectorsFile(
  startPath?: string
): Promise<string | null> {
  const cwd = startPath || process.cwd();

  const files = await globby(CONNECTORS_FILE_PATTERNS, {
    cwd,
    absolute: true,
  });

  return files[0] ?? null;
}

/**
 * Get the default path for the connectors file
 */
export function getDefaultConnectorsPath(projectRoot?: string): string {
  const root = projectRoot || process.cwd();
  return join(root, PROJECT_SUBDIR, "connectors.jsonc");
}

/**
 * Read all connectors from the local config file
 */
export async function readLocalConnectors(
  projectRoot?: string
): Promise<LocalConnector[]> {
  const filePath = await findConnectorsFile(projectRoot);

  if (!filePath) {
    return [];
  }

  const parsed = await readJsonFile(filePath);
  const result = ConnectorsFileSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Invalid connectors configuration: ${result.error.message}`
    );
  }

  const connectors: LocalConnector[] = [];

  for (const [type, config] of Object.entries(result.data)) {
    if (!isValidIntegration(type)) {
      throw new Error(`Unknown connector type: ${type}`);
    }

    connectors.push({
      type,
      scopes: config.scopes,
    });
  }

  return connectors;
}

/**
 * Write connectors to the local config file
 */
export async function writeLocalConnectors(
  connectors: LocalConnector[],
  projectRoot?: string
): Promise<string> {
  let filePath = await findConnectorsFile(projectRoot);

  if (!filePath) {
    filePath = getDefaultConnectorsPath(projectRoot);
  }

  const data: ConnectorsFile = {};

  for (const connector of connectors) {
    data[connector.type] = {
      ...(connector.scopes && { scopes: connector.scopes }),
    };
  }

  await writeJsonFile(filePath, data);

  return filePath;
}

/**
 * Add a connector to the local config file
 */
export async function addLocalConnector(
  type: IntegrationType,
  scopes?: string[],
  projectRoot?: string
): Promise<string> {
  const connectors = await readLocalConnectors(projectRoot);

  // Check if already exists
  const existing = connectors.find((c) => c.type === type);
  if (existing) {
    // Update scopes if provided
    if (scopes) {
      existing.scopes = scopes;
    }
  } else {
    connectors.push({ type, scopes });
  }

  return await writeLocalConnectors(connectors, projectRoot);
}

/**
 * Remove a connector from the local config file
 */
export async function removeLocalConnector(
  type: IntegrationType,
  projectRoot?: string
): Promise<string | null> {
  const connectors = await readLocalConnectors(projectRoot);
  const filtered = connectors.filter((c) => c.type !== type);

  if (filtered.length === connectors.length) {
    // Connector wasn't in the file
    return null;
  }

  return await writeLocalConnectors(filtered, projectRoot);
}

/**
 * Check if a connector exists in the local config file
 */
export async function hasLocalConnector(
  type: IntegrationType,
  projectRoot?: string
): Promise<boolean> {
  const connectors = await readLocalConnectors(projectRoot);
  return connectors.some((c) => c.type === type);
}
