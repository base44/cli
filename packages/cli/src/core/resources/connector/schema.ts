import { z } from "zod";

// Scopes: https://developers.google.com/identity/protocols/oauth2/scopes#calendar
const GoogleCalendarConnectorSchema = z.object({
  type: z.literal("googlecalendar"),
  scopes: z.array(z.string()).default([]),
});

// Scopes: https://developers.google.com/identity/protocols/oauth2/scopes#drive
const GoogleDriveConnectorSchema = z.object({
  type: z.literal("googledrive"),
  scopes: z.array(z.string()).default([]),
});

// Scopes: https://developers.google.com/identity/protocols/oauth2/scopes#gmail
const GmailConnectorSchema = z.object({
  type: z.literal("gmail"),
  scopes: z.array(z.string()).default([]),
});

// Scopes: https://developers.google.com/identity/protocols/oauth2/scopes#sheets
const GoogleSheetsConnectorSchema = z.object({
  type: z.literal("googlesheets"),
  scopes: z.array(z.string()).default([]),
});

// Scopes: https://developers.google.com/identity/protocols/oauth2/scopes#docs
const GoogleDocsConnectorSchema = z.object({
  type: z.literal("googledocs"),
  scopes: z.array(z.string()).default([]),
});

// Scopes: https://developers.google.com/identity/protocols/oauth2/scopes#slides
const GoogleSlidesConnectorSchema = z.object({
  type: z.literal("googleslides"),
  scopes: z.array(z.string()).default([]),
});

// Scopes: https://api.slack.com/scopes
const SlackConnectorSchema = z.object({
  type: z.literal("slack"),
  scopes: z.array(z.string()).default([]),
});

const NotionConnectorSchema = z.object({
  type: z.literal("notion"),
  scopes: z.array(z.string()).default([]).optional(),
});

// Scopes: https://developer.salesforce.com/docs/platform/mobile-sdk/guide/oauth-scope-parameter-values.html
const SalesforceConnectorSchema = z.object({
  type: z.literal("salesforce"),
  scopes: z.array(z.string()).default([]),
});

// Scopes: https://developers.hubspot.com/docs/api/scopes
const HubspotConnectorSchema = z.object({
  type: z.literal("hubspot"),
  scopes: z.array(z.string()).default([]),
});

// Scopes: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
const LinkedInConnectorSchema = z.object({
  type: z.literal("linkedin"),
  scopes: z.array(z.string()).default([]),
});

// Scopes: https://developers.tiktok.com/doc/tiktok-api-scopes
const TikTokConnectorSchema = z.object({
  type: z.literal("tiktok"),
  scopes: z.array(z.string()).default([]),
});

// Scopes: https://cloud.google.com/bigquery/docs/authorization
const GoogleBigQueryConnectorSchema = z.object({
  type: z.literal("googlebigquery"),
  scopes: z.array(z.string()).default([]),
});

const CustomTypeSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9_-]+$/i);

const GenericConnectorSchema = z.object({
  type: CustomTypeSchema,
  scopes: z.array(z.string()).default([]),
});

export const ConnectorResourceSchema = z.union([
  GoogleCalendarConnectorSchema,
  GoogleDriveConnectorSchema,
  GmailConnectorSchema,
  GoogleSheetsConnectorSchema,
  GoogleDocsConnectorSchema,
  GoogleSlidesConnectorSchema,
  GoogleBigQueryConnectorSchema,
  SlackConnectorSchema,
  NotionConnectorSchema,
  SalesforceConnectorSchema,
  HubspotConnectorSchema,
  LinkedInConnectorSchema,
  TikTokConnectorSchema,
  GenericConnectorSchema,
]);

export type ConnectorResource = z.infer<typeof ConnectorResourceSchema>;

const KnownIntegrationTypes = [
  "googlecalendar",
  "googledrive",
  "gmail",
  "googlesheets",
  "googledocs",
  "googleslides",
  "googlebigquery",
  "slack",
  "notion",
  "salesforce",
  "hubspot",
  "linkedin",
  "tiktok",
] as const;

export const IntegrationTypeSchema = z.union([
  z.enum(KnownIntegrationTypes),
  CustomTypeSchema,
]);

export type IntegrationType = z.infer<typeof IntegrationTypeSchema>;

const ConnectorStatusSchema = z.enum(["active", "disconnected", "expired"]);

const UpstreamConnectorSchema = z.object({
  integration_type: IntegrationTypeSchema,
  status: ConnectorStatusSchema,
  scopes: z.array(z.string()),
  user_email: z.string().optional(),
});

export const ListConnectorsResponseSchema = z
  .object({
    integrations: z.array(UpstreamConnectorSchema),
  })
  .transform((data) => ({
    integrations: data.integrations.map((i) => ({
      integrationType: i.integration_type,
      status: i.status,
      scopes: i.scopes,
      userEmail: i.user_email,
    })),
  }));

export type ListConnectorsResponse = z.infer<
  typeof ListConnectorsResponseSchema
>;

export const SetConnectorResponseSchema = z
  .object({
    redirect_url: z.string().nullable(),
    connection_id: z.string().nullable(),
    already_authorized: z.boolean(),
    error: z.string().nullable(),
    error_message: z.string().nullable(),
    other_user_email: z.string().nullable(),
  })
  .transform((data) => ({
    redirectUrl: data.redirect_url,
    connectionId: data.connection_id,
    alreadyAuthorized: data.already_authorized,
    error: data.error,
    errorMessage: data.error_message,
    otherUserEmail: data.other_user_email,
  }));

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

export const RemoveConnectorResponseSchema = z
  .object({
    status: z.literal("removed"),
    integration_type: IntegrationTypeSchema,
  })
  .transform((data) => ({
    status: data.status,
    integrationType: data.integration_type,
  }));

export type RemoveConnectorResponse = z.infer<
  typeof RemoveConnectorResponseSchema
>;
