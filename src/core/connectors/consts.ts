/**
 * Supported OAuth connector integrations.
 * Based on apper/backend/app/external_auth/models/constants.py
 */

export const SUPPORTED_INTEGRATIONS = [
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

export type IntegrationType = (typeof SUPPORTED_INTEGRATIONS)[number];

/**
 * Connector categories
 */
export type ConnectorCategory = "Communication" | "Productivity" | "CRM" | "Social" | "Google";

/**
 * Display names for integrations (for CLI output)
 */
export const INTEGRATION_DISPLAY_NAMES: Record<IntegrationType, string> = {
  googlecalendar: "Google Calendar",
  googledrive: "Google Drive",
  gmail: "Gmail",
  googlesheets: "Google Sheets",
  googledocs: "Google Docs",
  googleslides: "Google Slides",
  slack: "Slack",
  notion: "Notion",
  salesforce: "Salesforce",
  hubspot: "HubSpot",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
};

/**
 * Category metadata for each connector
 */
export const INTEGRATION_CATEGORIES: Record<IntegrationType, ConnectorCategory> = {
  slack: "Communication",
  notion: "Productivity",
  hubspot: "CRM",
  salesforce: "CRM",
  linkedin: "Social",
  tiktok: "Social",
  googlecalendar: "Google",
  googledrive: "Google",
  gmail: "Google",
  googlesheets: "Google",
  googledocs: "Google",
  googleslides: "Google",
};

export function isValidIntegration(type: string): type is IntegrationType {
  return SUPPORTED_INTEGRATIONS.includes(type as IntegrationType);
}

export function getIntegrationDisplayName(type: IntegrationType): string {
  return INTEGRATION_DISPLAY_NAMES[type] ?? type;
}

export function getIntegrationCategory(type: IntegrationType): ConnectorCategory {
  return INTEGRATION_CATEGORIES[type];
}
