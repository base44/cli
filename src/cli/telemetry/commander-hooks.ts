import type { Command, CommandUnknownOpts } from "@commander-js/extra-typings";
import type { ErrorReporter } from "./error-reporter.js";

/**
 * Get the full command name by traversing parent commands.
 * e.g., "base44 entities push" → "entities push"
 */
function getFullCommandName(command: CommandUnknownOpts): string {
  const parts: string[] = [];
  let current: CommandUnknownOpts | null = command;

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

export function addCommandInfoToErrorReporter(program: Command<any, any>, errorReporter: ErrorReporter): void {
  program.hook("preAction", (_, actionCommand) => {
    const fullCommandName = getFullCommandName(actionCommand);

    errorReporter.setContext({
      command: {
        name: fullCommandName,
        args: actionCommand.args,
        options: actionCommand.opts(),
      },
    });
  });
}
