import type { ProjectSDK } from "@/core/sdk.js";
import type { ErrorReporter } from "./telemetry/error-reporter.js";

export interface CLIContext {
  errorReporter: ErrorReporter;
  sdk: ProjectSDK;
}
