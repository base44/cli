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

const StripeConnectorSchema = z.object({
  type: z.literal("stripe"),
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
  StripeConnectorSchema,
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
  "stripe",
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

// ─── STRIPE-SPECIFIC SCHEMAS ─────────────────────────────────

export const STRIPE_CONNECTOR_TYPE = "stripe" as const;

export const InstallStripeResponseSchema = z
  .object({
    already_installed: z.boolean(),
    claim_url: z.string().nullable(),
  })
  .transform((data) => ({
    alreadyInstalled: data.already_installed,
    claimUrl: data.claim_url,
  }));

export type InstallStripeResponse = z.infer<typeof InstallStripeResponseSchema>;

export const StripeStatusResponseSchema = z
  .object({
    stripe_mode: z.enum(["sandbox", "live"]).nullable(),
    sandbox_claim_url: z.string().nullable().optional(),
  })
  .transform((data) => ({
    stripeMode: data.stripe_mode,
    sandboxClaimUrl: data.sandbox_claim_url,
  }));

export type StripeStatusResponse = z.infer<typeof StripeStatusResponseSchema>;

export const RemoveStripeResponseSchema = z.object({
  success: z.boolean(),
});

export type RemoveStripeResponse = z.infer<typeof RemoveStripeResponseSchema>;

// ─── LIST AVAILABLE INTEGRATIONS ─────────────────────────────

const ConnectionConfigFieldSchema = z.object({
  name: z.string(),
  display_name: z.string(),
  description: z.string(),
  placeholder: z.string(),
  required: z.boolean(),
  validation_pattern: z.string().nullable().optional(),
  validation_error: z.string().nullable().optional(),
});

const AvailableIntegrationSchema = z.object({
  // Uses z.string() instead of IntegrationTypeSchema — the API may return
  // integration types not yet known to the CLI.
  integration_type: z.string().min(1),
  display_name: z.string(),
  description: z.string(),
  connection_config_fields: z.array(ConnectionConfigFieldSchema),
});

export const ListAvailableIntegrationsResponseSchema = z
  .object({
    integrations: z.array(AvailableIntegrationSchema),
  })
  .transform((data) => ({
    integrations: data.integrations.map((i) => ({
      integrationType: i.integration_type,
      displayName: i.display_name,
      description: i.description,
      connectionConfigFields: i.connection_config_fields.map((f) => ({
        name: f.name,
        displayName: f.display_name,
        description: f.description,
        placeholder: f.placeholder,
        required: f.required,
        validationPattern: f.validation_pattern,
        validationError: f.validation_error,
      })),
    })),
  }));

export type ListAvailableIntegrationsResponse = z.infer<
  typeof ListAvailableIntegrationsResponseSchema
>;
