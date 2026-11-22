import type { McpConfig } from "./schema.js";

const DEFAULT_CONSENT_PATH = "/oauth/consent";

/**
 * What a user needs to know after pushing a config, beyond the push itself:
 * platform behaviour the CLI can't check from here.
 */
export function mcpConfigNotes(
  config: McpConfig,
  options: { siteDeployed?: boolean } = {},
): string[] {
  const notes: string[] = [];
  if (!options.siteDeployed) {
    notes.push(
      "The MCP server answers only once the app's site has been deployed at least once.",
    );
  }
  if (config.auth !== "none") {
    const consentPath =
      typeof config.consent_path === "string"
        ? config.consent_path
        : DEFAULT_CONSENT_PATH;
    notes.push(
      `OAuth mode needs a consent page routed at ${consentPath} in the app's site.`,
    );
  }
  return notes;
}
