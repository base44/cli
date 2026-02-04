import { z } from "zod";

// ─── CONNECTOR SCHEMAS PER INTEGRATION ────────────────────────────────────────
// Each integration has a literal type discriminator.
// Scopes are provider-specific - see official docs for available scopes.

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

/** Notion - Scopes: https://developers.notion.com/docs/authorization (page-based access model) */
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

/** LinkedIn - Scopes: https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access */
export const LinkedInConnectorSchema = z.object({
  type: z.literal("linkedin"),
  scopes: z.array(z.string()).default([]),
});

/** TikTok - Scopes: https://developers.tiktok.com/doc/scopes-overview */
export const TikTokConnectorSchema = z.object({
  type: z.literal("tiktok"),
  scopes: z.array(z.string()).default([]),
});

// ─── DISCRIMINATED UNION ──────────────────────────────────────────────────────

/**
 * Local connector resource schema using discriminated union.
 * Each integration type has its own schema with a literal type discriminator.
 */
export const ConnectorResourceSchema = z.discriminatedUnion("type", [
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
]);

export type ConnectorResource = z.infer<typeof ConnectorResourceSchema>;

/**
 * Supported OAuth integration types.
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

// ─── API RESPONSE SCHEMAS ─────────────────────────────────────────────────────

/**
 * Connector status from upstream API.
 */
export const ConnectorStatusSchema = z.enum([
  "ACTIVE",
  "DISCONNECTED",
  "EXPIRED",
]);

export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;

/**
 * Upstream connector from the list API.
 */
export const UpstreamConnectorSchema = z.object({
  integration_type: IntegrationTypeSchema,
  status: ConnectorStatusSchema,
  scopes: z.array(z.string()),
  user_email: z.string().optional(),
});

export type UpstreamConnector = z.infer<typeof UpstreamConnectorSchema>;

/**
 * Response from GET /api/apps/{app_id}/external-auth/list
 */
export const ListConnectorsResponseSchema = z.object({
  integrations: z.array(UpstreamConnectorSchema),
});

export type ListConnectorsResponse = z.infer<
  typeof ListConnectorsResponseSchema
>;

/**
 * Response from GET /api/external-auth/auto-added-scopes
 */
export const AutoAddedScopesResponseSchema = z.record(
  IntegrationTypeSchema,
  z.array(z.string())
);

export type AutoAddedScopesResponse = z.infer<
  typeof AutoAddedScopesResponseSchema
>;
