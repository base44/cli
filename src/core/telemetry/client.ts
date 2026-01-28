import Mixpanel from "mixpanel";

const DEFAULT_MIXPANEL_TOKEN = "a5a83c59e9fbe594bfb6d3124690a59f";

let mixpanelClient: Mixpanel.Mixpanel | null = null;

/**
 * Get the Mixpanel project token.
 * Uses environment variable if set, otherwise falls back to default.
 */
export function getMixpanelToken(): string {
  return process.env.MIXPANEL_TOKEN || DEFAULT_MIXPANEL_TOKEN;
}

/**
 * Check if telemetry is enabled.
 * Telemetry is disabled if BASE44_TELEMETRY_DISABLED is set to "1" or "true"
 */
export function isTelemetryEnabled(): boolean {
  const disabled = process.env.BASE44_TELEMETRY_DISABLED;
  if (disabled === "1" || disabled === "true") {
    return false;
  }

  return true;
}

/**
 * Initialize the Mixpanel client.
 * This should be called once at CLI startup.
 * Safe to call multiple times - subsequent calls are no-ops.
 */
export function initMixpanel(): Mixpanel.Mixpanel | null {
  if (mixpanelClient) {
    return mixpanelClient;
  }

  if (!isTelemetryEnabled()) {
    return null;
  }

  mixpanelClient = Mixpanel.init(getMixpanelToken());

  return mixpanelClient;
}

/**
 * Get the initialized Mixpanel client.
 * Returns null if telemetry is disabled or not initialized.
 */
export function getMixpanelClient(): Mixpanel.Mixpanel | null {
  return mixpanelClient;
}

/**
 * Reset the Mixpanel client. Useful for testing.
 */
export function resetMixpanelClient(): void {
  mixpanelClient = null;
}
