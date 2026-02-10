import { z } from "zod";

/** Google Calendar - Scopes: https://developers.google.com/identity/protocols/oauth2/scopes#calendar */
export const GoogleCalendarConnectorSchema = z.object({
  type: z.literal("googlecalendar"),
  scopes: z.array(z.string()).default([]),
});

/** Google Drive - Scopes: https://developers.google.com/identity/protocols/oauth2/scopes#drive */
export const GoogleDriveConnectorSchema = z.object({
  type: z.literal("googledrive"),
  scopes: z.array(z.string()).default([]),
});

/** Gmail - Scopes: https://developers.google.com/identity/protocols/oauth2/scopes#gmail */
export const GmailConnectorSchema = z.object({
  type: z.literal("gmail"),
  scopes: z.array(z.string()).default([]),
});

/** Google Sheets - Scopes: https://developers.google.com/identity/protocols/oauth2/scopes#sheets */
export const GoogleSheetsConnectorSchema = z.object({
  type: z.literal("googlesheets"),
  scopes: z.array(z.string()).default([]),
});

/** Google Docs - Scopes: https://developers.google.com/identity/protocols/oauth2/scopes#docs */
export const GoogleDocsConnectorSchema = z.object({
  type: z.literal("googledocs"),
  scopes: z.array(z.string()).default([]),
});

/** Google Slides - Scopes: https://developers.google.com/identity/protocols/oauth2/scopes#slides */
export const GoogleSlidesConnectorSchema = z.object({
  type: z.literal("googleslides"),
  scopes: z.array(z.string()).default([]),
});

/** Slack - Scopes: https://api.slack.com/scopes */
export const SlackConnectorSchema = z.object({
  type: z.literal("slack"),
  scopes: z.array(z.string()).default([]),
});

/** Notion - Scopes are preauthorized by Notion and don't need to be explicitly requested */
export const NotionConnectorSchema = z.object({
  type: z.literal("notion"),
  scopes: z.array(z.string()).default([]),
});

/** Salesforce - Scopes: https://developer.salesforce.com/docs/platform/mobile-sdk/guide/oauth-scope-parameter-values.html */
export const SalesforceConnectorSchema = z.object({
  type: z.literal("salesforce"),
  scopes: z.array(z.string()).default([]),
});

/** HubSpot - Scopes: https://developers.hubspot.com/docs/api/scopes */
export const HubspotConnectorSchema = z.object({
  type: z.literal("hubspot"),
  scopes: z.array(z.string()).default([]),
});

/** LinkedIn - Scopes: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow */
export const LinkedInConnectorSchema = z.object({
  type: z.literal("linkedin"),
  scopes: z.array(z.string()).default([]),
});

/** TikTok - Scopes: https://developers.tiktok.com/doc/tiktok-api-scopes */
export const TikTokConnectorSchema = z.object({
  type: z.literal("tiktok"),
  scopes: z.array(z.string()).default([]),
});

/** Generic connector schema for arbitrary providers */
const GenericConnectorSchema = z.object({
  type: z.string().min(1).regex(/^[a-z0-9_-]+$/i),
  scopes: z.array(z.string()).default([]),
});

/**
 * Connector resource schema that accepts both known providers (with specific schemas)
 * and arbitrary provider strings (with generic schema).
 */
export const ConnectorResourceSchema = z.union([
  GoogleCalendarConnectorSchema,
  GoogleDriveConnectorSchema,
  GmailConnectorSchema,
  GoogleSheetsConnectorSchema,
  GoogleDocsConnectorSchema,
  GoogleSlidesConnectorSchema,
  SlackConnectorSchema,
  NotionConnectorSchema,
  SalesforceConnectorSchema,
  HubspotConnectorSchema,
  LinkedInConnectorSchema,
  TikTokConnectorSchema,
  GenericConnectorSchema,
]);

export type ConnectorResource = z.infer<typeof ConnectorResourceSchema>;

/** Known integration types with first-class support */
export const KnownIntegrationTypes = [
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
] as const;

/**
 * Integration type schema that accepts both known providers and arbitrary strings.
 * This allows users to use custom OAuth providers not yet supported by Base44.
 */
export const IntegrationTypeSchema = z.union([
  z.enum(KnownIntegrationTypes),
  z.string().min(1).regex(/^[a-z0-9_-]+$/i),
]);

export type IntegrationType = z.infer<typeof IntegrationTypeSchema>;

export const ConnectorStatusSchema = z.enum([
  "active",
  "disconnected",
  "expired",
]);

export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;

export const UpstreamConnectorSchema = z.object({
  integration_type: IntegrationTypeSchema,
  status: ConnectorStatusSchema,
  scopes: z.array(z.string()),
  user_email: z.string().optional(),
});

export type UpstreamConnector = z.infer<typeof UpstreamConnectorSchema>;

export const ListConnectorsResponseSchema = z.object({
  integrations: z.array(UpstreamConnectorSchema),
});

export type ListConnectorsResponse = z.infer<
  typeof ListConnectorsResponseSchema
>;

export const SetConnectorResponseSchema = z.object({
  redirect_url: z.string().nullable(),
  connection_id: z.string().nullable(),
  already_authorized: z.boolean(),
  error: z.string().nullable().optional(),
  error_message: z.string().nullable().optional(),
  other_user_email: z.string().nullable().optional(),
});

export type SetConnectorResponse = z.infer<typeof SetConnectorResponseSchema>;

export const ConnectorOAuthStatusSchema = z.enum([
  "ACTIVE",
  "FAILED",
  "PENDING",
]);

export type ConnectorOAuthStatus = z.infer<typeof ConnectorOAuthStatusSchema>;

export const OAuthStatusResponseSchema = z.object({
  status: ConnectorOAuthStatusSchema,
});

export type OAuthStatusResponse = z.infer<typeof OAuthStatusResponseSchema>;

export const RemoveConnectorResponseSchema = z.object({
  status: z.literal("removed"),
  integration_type: IntegrationTypeSchema,
});

export type RemoveConnectorResponse = z.infer<
  typeof RemoveConnectorResponseSchema
>;
