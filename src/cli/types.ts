import type { ErrorReporter } from "./telemetry/error-reporter.js";
import type { Base44LocalProjectSDK } from "@/core/index.js";

export interface CLIContext {
  errorReporter: ErrorReporter;
  /** SDK instance, available after app config is initialized */
  sdk: Base44LocalProjectSDK | null;
}
