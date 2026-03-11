import type { Resource } from "../types.js";
import { readAllConnectors } from "./config.js";
import { pushConnectors } from "./push.js";
import type { ConnectorResource } from "./schema.js";

export const connectorResource: Resource<ConnectorResource> = {
  readAll: readAllConnectors,
  push: pushConnectors,
};
