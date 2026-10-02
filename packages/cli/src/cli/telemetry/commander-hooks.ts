import type { Command } from "commander";
import type { ErrorReporter } from "./error-reporter.js";

/**
 * Get the full command name by traversing parent commands.
 * e.g., "base44 entities push" → "entities push"
 */
function getFullCommandName(command: Command): string {
  const parts: string[] = [];
  let current: Command | null = command;

  while (current) {
    const name = current.name();
    // Skip the root program name
    if (current.parent) {
      parts.unshift(name);
    }
    current = current.parent;
  }

  return parts.join(" ");
}

// Option values that are credentials never leave the machine, even on a crash.
const SENSITIVE_OPTION = /secret|token|password|launch|instance|key$/i;

function redactSensitiveOptions(
  options: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(options).map(([k, v]) => [
      k,
      SENSITIVE_OPTION.test(k) && v != null && v !== false ? "[redacted]" : v,
    ]),
  );
}

export function addCommandInfoToErrorReporter(
  program: Command,
  errorReporter: ErrorReporter,
): void {
  program.hook("preAction", (_, actionCommand) => {
    const fullCommandName = getFullCommandName(actionCommand);

    errorReporter.setContext({
      command: {
        name: fullCommandName,
        args: actionCommand.args,
        options: redactSensitiveOptions(actionCommand.opts()),
      },
    });
  });
}
