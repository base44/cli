import type { Logger } from "@base44-cli/logger";
import type { AppContext } from "@/core/project/app-config.js";
import type { ErrorReporter } from "./telemetry/error-reporter.js";
import type { RunTaskFn } from "./utils/runTask.js";

export type Distribution = "npm" | "binary";

export interface CLIContext {
  errorReporter: ErrorReporter;
  isNonInteractive: boolean;
  /**
   * The global `--json` flag is set. Commands should emit a machine-readable
   * JSON document via `RunCommandResult.stdout` and skip human-oriented logs;
   * the lifecycle keeps stdout pure (status/logs are routed to stderr).
   */
  jsonMode: boolean;
  /**
   * The experimental static-site deployments lane is on for this process
   * (`BASE44_STATIC_DEPLOYMENTS`). This is the only place the gate is read —
   * commands pass it down, so no layer below re-reads the environment and the
   * whole run agrees on one answer.
   */
  staticDeployments: boolean;
  distribution: Distribution;
  log: Logger;
  runTask: RunTaskFn;
  app?: AppContext;
}

export interface RunCommandResult {
  outroMessage?: string;
  /**
   * Raw text to write to stdout after the command UI (intro/outro) finishes.
   * Useful for commands that produce machine-readable or pipeable output.
   */
  stdout?: string;
}
