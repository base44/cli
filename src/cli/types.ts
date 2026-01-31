import type { ErrorReporter } from "./telemetry/error-reporter.js";

export interface CLIContext {
  errorReporter: ErrorReporter;
}
