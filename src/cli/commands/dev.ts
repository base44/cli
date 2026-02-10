import { Command } from "commander";
import React from "react";
import { theme } from "@/cli/utils/theme.js";
import { isCLIError } from "@/core/errors.js";
import { DevCommand } from "../dev/DevCommand";
import { render } from "../ink-render/renderer";
import type { CLIContext } from "../types";

async function devAction(context: CLIContext): Promise<void> {
  try {
    await render(React.createElement(DevCommand));
  } catch (error) {
    // Display error message
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(errorMessage);

    // Show stack trace if DEBUG mode
    if (process.env.DEBUG === "1" && error instanceof Error && error.stack) {
      console.error(theme.styles.dim(error.stack));
    }

    // Display hints if this is a CLIError with hints
    if (isCLIError(error)) {
      const hints = theme.format.agentHints(error.hints);
      if (hints) {
        console.error(hints);
      }
    }

    // Get error context and display in outro
    const errorContext = context.errorReporter.getErrorContext();
    console.log(theme.format.errorContext(errorContext));

    // Re-throw for runCLI to handle (error reporting, exit code)
    throw error;
  }
}

export function getDevCommand(context: CLIContext): Command {
  return new Command("dev")
    .description("Start the development server")
    .action(async () => {
      await devAction(context);
    });
}
