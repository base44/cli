import { readLocalConnectors } from "./config.js";
import { listConnectors } from "./api.js";
import type { LocalConnector } from "./config.js";
import type { Connector } from "./schema.js";

export interface ConnectorState {
  local: LocalConnector[];
  backend: Connector[];
}

/**
 * Fetches both local config and backend connectors in parallel.
 * Gracefully handles failures by returning empty arrays.
 */
export async function fetchConnectorState(): Promise<ConnectorState> {
  const [local, backend] = await Promise.all([
    readLocalConnectors().catch(() => [] as LocalConnector[]),
    listConnectors().catch(() => [] as Connector[]),
  ]);
  return { local, backend };
}
