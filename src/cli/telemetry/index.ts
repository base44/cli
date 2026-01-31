export { ErrorReporter } from "./error-reporter.js";
export type { ErrorContext } from "./error-reporter.js";
export { addCommandInfoToErrorReporter } from "./commander-hooks.js";
export { getPostHogClient, isTelemetryEnabled, shutdownPostHog } from "./posthog.js";
