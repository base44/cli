import type { ErrorReporter } from "./telemetry/error-reporter.js";
import type { Logger } from "./utils/logger/types.js";

export type Distribution = "npm" | "binary";

export interface CLIContext {
  errorReporter: ErrorReporter;
  isNonInteractive: boolean;
  distribution: Distribution;
  logger: Logger;
}

/**
 * Type for Base44Command action functions.
 * CLIContext is always injected as the first argument by Base44Command,
 * followed by Commander's positional args, options, and command instance.
 */
export type CommandAction = (
  ctx: CLIContext,
  // biome-ignore lint/suspicious/noExplicitAny: Commander passes variable positional args after CLIContext
  ...args: any[]
  // biome-ignore lint/suspicious/noConfusingVoidType: void is the standard return for functions that don't return a value
) => void | Promise<undefined | RunCommandResult>;

export interface RunCommandResult {
  outroMessage?: string;
  /**
   * Raw text to write to stdout after the command UI (intro/outro) finishes.
   * Useful for commands that produce machine-readable or pipeable output.
   */
  stdout?: string;
}
