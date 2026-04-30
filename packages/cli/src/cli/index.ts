import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClackLogger, SimpleLogger } from "@base44-cli/logger";
import { createProgram } from "@/cli/program.js";
import { ensureNpmAssets } from "@/core/assets.js";
import { readAuth } from "@/core/auth/index.js";
import { CLIExitError } from "./errors.js";
import { ErrorReporter } from "./telemetry/error-reporter.js";
import { addCommandInfoToErrorReporter } from "./telemetry/index.js";
import type { CLIContext, Distribution } from "./types.js";
import {
  createInteractiveRunTask,
  createSimpleRunTask,
} from "./utils/runTask.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RunCLIOptions {
  distribution?: Distribution;
}

async function runCLI(options?: RunCLIOptions): Promise<void> {
  ensureNpmAssets(join(__dirname, "../assets"));

  // Create error reporter - single instance for the CLI session
  const errorReporter = new ErrorReporter();

  // Register process error handlers FIRST
  errorReporter.registerProcessErrorHandlers();

  // Create context for dependency injection
  const isNonInteractive = !process.stdin.isTTY || !process.stdout.isTTY;
  const log = isNonInteractive ? new SimpleLogger() : new ClackLogger();
  const runTask = isNonInteractive
    ? createSimpleRunTask(log)
    : createInteractiveRunTask();
  const context: CLIContext = {
    errorReporter,
    isNonInteractive,
    distribution: options?.distribution ?? "npm",
    log,
    runTask,
  };

  // Create program with injected context
  const program = createProgram(context);

  try {
    const userInfo = await readAuth();
    errorReporter.setContext({
      user: { email: userInfo.email, name: userInfo.name },
    });
  } catch {
    // User info is optional context
  }

  addCommandInfoToErrorReporter(program, errorReporter);

  try {
    await program.parseAsync();
  } catch (error) {
    // CLIExitError = controlled exit (e.g., user cancellation), don't report
    if (!(error instanceof CLIExitError)) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      errorReporter.captureException(errorObj);
    }

    // Use exitCode instead of exit() to let event loop drain
    process.exitCode = error instanceof CLIExitError ? error.code : 1;
  }
}

export { CLIExitError, createProgram, runCLI };
