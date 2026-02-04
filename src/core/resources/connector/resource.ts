import type { Resource } from "../types.js";
import { readAllConnectors } from "./config.js";
import type { ConnectorResource } from "./schema.js";

/**
 * Connector resource implementation.
 * Note: Connectors are push-only (no pull support).
 * The push function will be implemented when the OAuth flow is ready.
 */
export const connectorResource: Resource<ConnectorResource> = {
  readAll: readAllConnectors,
  push: async () => {
    // Push will be implemented in the OAuth flow task
    throw new Error("Connector push not yet implemented");
  },
};
