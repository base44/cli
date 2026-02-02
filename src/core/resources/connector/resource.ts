import { readAllConnectors } from "@/core/resources/connector/config.js";
import { pushConnectors } from "@/core/resources/connector/deploy.js";
import type { ConnectorResource } from "@/core/resources/connector/schema.js";
import type { Resource } from "@/core/resources/types.js";

export const connectorResource: Resource<ConnectorResource> = {
  readAll: readAllConnectors,
  push: pushConnectors,
};
