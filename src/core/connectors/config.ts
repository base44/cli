import { findProjectRoot } from "../project/config.js";
import { readJsonFile, writeJsonFile } from "../utils/fs.js";
import { isValidIntegration } from "./constants.js";
import type { IntegrationType } from "./constants.js";
import type { ConnectorsConfig } from "../project/schema.js";

/**
 * Parsed connector with its type
 */
export interface LocalConnector {
  type: IntegrationType;
  scopes?: string[];
}

/**
 * Read all connectors from the project config file
 */
export async function readLocalConnectors(
  projectRoot?: string
): Promise<LocalConnector[]> {
  const found = await findProjectRoot(projectRoot);

  if (!found) {
    return [];
  }

  const parsed = (await readJsonFile(found.configPath)) as Record<string, unknown>;
  const connectorsData = parsed.connectors as ConnectorsConfig | undefined;

  if (!connectorsData) {
    return [];
  }

  const connectors: LocalConnector[] = [];

  for (const [type, config] of Object.entries(connectorsData)) {
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
 * Write connectors to the project config file
 */
export async function writeLocalConnectors(
  connectors: LocalConnector[],
  projectRoot?: string
): Promise<string> {
  const found = await findProjectRoot(projectRoot);

  if (!found) {
    throw new Error("Project config not found. Run this command from a Base44 project directory.");
  }

  // Read existing config to preserve other fields
  const existingConfig = (await readJsonFile(found.configPath)) as Record<string, unknown>;

  // Build connectors object
  const connectorsData: ConnectorsConfig = {};

  for (const connector of connectors) {
    connectorsData[connector.type] = {
      ...(connector.scopes && { scopes: connector.scopes }),
    };
  }

  // Update config with new connectors
  const updatedConfig = {
    ...existingConfig,
    connectors: Object.keys(connectorsData).length > 0 ? connectorsData : undefined,
  };

  // Remove connectors key if empty
  if (!updatedConfig.connectors) {
    delete updatedConfig.connectors;
  }

  await writeJsonFile(found.configPath, updatedConfig);

  return found.configPath;
}

/**
 * Add a connector to the project config file
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
 * Remove a connector from the project config file
 */
export async function removeLocalConnector(
  type: IntegrationType,
  projectRoot?: string
): Promise<string | null> {
  const connectors = await readLocalConnectors(projectRoot);
  const filtered = connectors.filter((c) => c.type !== type);

  if (filtered.length === connectors.length) {
    // Connector wasn't in the config
    return null;
  }

  return await writeLocalConnectors(filtered, projectRoot);
}

/**
 * Check if a connector exists in the project config file
 */
export async function hasLocalConnector(
  type: IntegrationType,
  projectRoot?: string
): Promise<boolean> {
  const connectors = await readLocalConnectors(projectRoot);
  return connectors.some((c) => c.type === type);
}
