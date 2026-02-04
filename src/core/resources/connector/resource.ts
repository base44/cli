import type { Resource } from "../types.js";
import { readAllConnectors } from "./config.js";
import type { ConnectorResource } from "./schema.js";

export const connectorResource: Resource<ConnectorResource> = {
  readAll: readAllConnectors,
  push: async () => {
    throw new Error("Connector push not yet implemented");
  },
};
