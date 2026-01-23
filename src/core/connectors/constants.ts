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

export function isValidIntegration(type: string): type is IntegrationType {
  return SUPPORTED_INTEGRATIONS.includes(type as IntegrationType);
}

export function getIntegrationDisplayName(type: string): string {
  if (isValidIntegration(type)) {
    return INTEGRATION_DISPLAY_NAMES[type];
  }
  return type;
}
