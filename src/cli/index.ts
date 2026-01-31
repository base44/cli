import type { CLIContext } from "./types.js";
import { CLIExitError } from "./errors.js";
import { ErrorReporter } from "./telemetry/error-reporter.js";
import { addCommandInfoToErrorReporter } from "./telemetry/index.js";
import { readAuth } from "@/core/auth/index.js";
import { createProgram } from "@/cli/program.js";

async function runCLI(): Promise<void> {
  // Create error reporter - single instance for the CLI session
  const errorReporter = new ErrorReporter();

  // Register process error handlers FIRST
  errorReporter.registerProcessErrorHandlers();

  // Create context for dependency injection
  const context: CLIContext = { errorReporter };

  // Create program with injected context
  const program = createProgram(context);

  try {
    const userInfo = await readAuth();
    errorReporter.setContext({ user: { email: userInfo.email, name: userInfo.name } });
  } catch {
    // User info is optional context
  }

  addCommandInfoToErrorReporter(program, errorReporter);

  try {
    await program.parseAsync();
  } catch (error) {
    // CLIExitError = controlled exit (e.g., user cancellation), don't report
    if (!(error instanceof CLIExitError)) {
      errorReporter.captureException(
        error instanceof Error ? error : new Error(String(error))
      );
    }

    // Use exitCode instead of exit() to let event loop drain
    process.exitCode = error instanceof CLIExitError ? error.code : 1;
  }
}

export { runCLI, createProgram, CLIExitError };
