import type { Base44LocalProjectSDK } from "@/core/index.js";
import type { ErrorReporter } from "./telemetry/error-reporter.js";

export interface CLIContext {
  errorReporter: ErrorReporter;
  /** SDK instance (initialized lazily, available for future use) */
  sdk?: Base44LocalProjectSDK | null;
}
