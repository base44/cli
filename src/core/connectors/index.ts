// API functions
export {
  initiateOAuth,
  checkOAuthStatus,
  listConnectors,
  disconnectConnector,
  removeConnector,
} from "./api.js";

// Local config functions
export {
  readLocalConnectors,
  writeLocalConnectors,
  addLocalConnector,
  removeLocalConnector,
  hasLocalConnector,
  findConnectorsFile,
  getDefaultConnectorsPath,
} from "./config.js";

export type { LocalConnector, ConnectorConfig, ConnectorsFile } from "./config.js";

// Schemas and types
export {
  InitiateResponseSchema,
  StatusResponseSchema,
  ConnectorSchema,
  ListResponseSchema,
  ApiErrorSchema,
} from "./schema.js";

export type {
  InitiateResponse,
  StatusResponse,
  Connector,
  ListResponse,
  ApiError,
} from "./schema.js";

// Constants
export {
  SUPPORTED_INTEGRATIONS,
  INTEGRATION_DISPLAY_NAMES,
  isValidIntegration,
  getIntegrationDisplayName,
} from "./constants.js";

export type { IntegrationType } from "./constants.js";
