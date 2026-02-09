export { addCommandInfoToErrorReporter } from "./commander-hooks.js";
export type { ErrorContext } from "./error-reporter.js";
export { ErrorReporter } from "./error-reporter.js";
export {
  getPostHogClient,
  isTelemetryEnabled,
  shutdownPostHog,
} from "./posthog.js";
