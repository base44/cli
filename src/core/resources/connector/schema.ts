import { z } from "zod";

/**
 * All supported OAuth integration types
 */
export const IntegrationTypeSchema = z.enum([
  "googlecalendar",
  "googledrive",
  "gmail",
  "googlesheets",
  "googledocs",
  "googleslides",
  "slack",
  "notion",
  "salesforce",
  "hubspot",
  "linkedin",
  "tiktok",
]);

export type IntegrationType = z.infer<typeof IntegrationTypeSchema>;

/**
 * Local connector resource file schema
 * Represents a single connector configuration file (e.g., connectors/googlecalendar.jsonc)
 */
export const ConnectorResourceSchema = z.object({
  type: IntegrationTypeSchema,
  scopes: z.array(z.string()).min(0),
});

export type ConnectorResource = z.infer<typeof ConnectorResourceSchema>;

/**
 * Upstream connector status from API
 */
export const ConnectorStatusSchema = z.enum([
  "ACTIVE",
  "DISCONNECTED",
  "EXPIRED",
]);

export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;

/**
 * Upstream integration from list endpoint
 */
export const UpstreamIntegrationSchema = z.object({
  integration_type: IntegrationTypeSchema,
  status: ConnectorStatusSchema,
  scopes: z.array(z.string()),
  user_email: z.string().optional(),
});

export type UpstreamIntegration = z.infer<typeof UpstreamIntegrationSchema>;

/**
 * List connectors response
 */
export const ListConnectorsResponseSchema = z.object({
  integrations: z.array(UpstreamIntegrationSchema),
});

export type ListConnectorsResponse = z.infer<
  typeof ListConnectorsResponseSchema
>;

/**
 * Initiate OAuth flow request
 */
export const InitiateOAuthRequestSchema = z.object({
  integration_type: IntegrationTypeSchema,
  scopes: z.array(z.string()),
  force_reconnect: z.boolean().optional(),
});

export type InitiateOAuthRequest = z.infer<typeof InitiateOAuthRequestSchema>;

/**
 * Initiate OAuth flow response
 */
export const InitiateOAuthResponseSchema = z.object({
  redirect_url: z.string(),
  connection_id: z.string(),
  already_authorized: z.boolean(),
});

export type InitiateOAuthResponse = z.infer<
  typeof InitiateOAuthResponseSchema
>;

/**
 * OAuth status from polling endpoint
 */
export const OAuthStatusSchema = z.enum(["ACTIVE", "FAILED", "PENDING"]);

export type OAuthStatus = z.infer<typeof OAuthStatusSchema>;

/**
 * OAuth status response
 */
export const OAuthStatusResponseSchema = z.object({
  status: OAuthStatusSchema,
  error: z.string().optional(),
  user_email: z.string().optional(),
});

export type OAuthStatusResponse = z.infer<typeof OAuthStatusResponseSchema>;

/**
 * Push result for a single connector
 */
export interface ConnectorPushResult {
  type: IntegrationType;
  status:
    | "ACTIVE"
    | "SCOPE_MISMATCH"
    | "PENDING_AUTH"
    | "AUTH_FAILED"
    | "DELETED"
    | "DIFFERENT_USER";
  details?: string;
  error?: string;
}

/**
 * Overall push summary
 */
export interface ConnectorsPushSummary {
  results: ConnectorPushResult[];
  hasWarnings: boolean;
  hasErrors: boolean;
}
