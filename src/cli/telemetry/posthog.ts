import { PostHog } from "posthog-node";
import {
  POSTHOG_API_KEY,
  POSTHOG_REQUEST_TIMEOUT_MS,
  TELEMETRY_DISABLED_ENV_VAR,
} from "./consts.js";

let client: PostHog | null = null;

/**
 * Check if telemetry/error reporting is enabled.
 * Disabled via BASE44_DISABLE_TELEMETRY=1
 */
export function isTelemetryEnabled(): boolean {
  return process.env[TELEMETRY_DISABLED_ENV_VAR] !== "1";
}

/**
 * Get or create the PostHog client singleton.
 * Returns null if error reporting is disabled.
 */
export function getPostHogClient(): PostHog | null {
  if (!isTelemetryEnabled()) {
    return null;
  }

  if (!client) {
    try {
      client = new PostHog(POSTHOG_API_KEY, {
        host: "https://us.i.posthog.com",
        // CLI settings: flush immediately since process may exit soon
        flushAt: 1,
        flushInterval: 0,
        // Short timeout - don't block CLI on error path
        requestTimeout: POSTHOG_REQUEST_TIMEOUT_MS,
      });
    } catch {
      // Failed to create client - log and continue without error reporting
      return null;
    }
  }

  return client;
}
