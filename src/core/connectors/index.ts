// API functions
export {
  initiateOAuth,
  checkOAuthStatus,
  listConnectors,
  disconnectConnector,
  removeConnector,
} from "./api.js";

// OAuth flow utilities
export { waitForOAuthCompletion } from "./oauth.js";
export type { OAuthCompletionResult } from "./oauth.js";

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
  OAUTH_POLL_INTERVAL_MS,
  OAUTH_POLL_TIMEOUT_MS,
  SUPPORTED_INTEGRATIONS,
  INTEGRATION_DISPLAY_NAMES,
  isValidIntegration,
  getIntegrationDisplayName,
} from "./constants.js";

export type { IntegrationType } from "./constants.js";
