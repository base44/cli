import type { Logger } from "@base44-cli/logger";
import type { ErrorReporter } from "./telemetry/error-reporter.js";
import type { RunTaskFn } from "./utils/runTask.js";

export type Distribution = "npm" | "binary";

export interface CLIContext {
  errorReporter: ErrorReporter;
  isNonInteractive: boolean;
  distribution: Distribution;
  log: Logger;
  runTask: RunTaskFn;
}

export interface RunCommandResult {
  outroMessage?: string;
  /**
   * Raw text to write to stdout after the command UI (intro/outro) finishes.
   * Useful for commands that produce machine-readable or pipeable output.
   */
  stdout?: string;
}
