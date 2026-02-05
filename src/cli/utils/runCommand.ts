import { intro, log, outro } from "@clack/prompts";
import { login } from "@/cli/commands/auth/login-flow.js";
import type { CLIContext } from "@/cli/types.js";
import { printBanner } from "@/cli/utils/banner.js";
import { theme } from "@/cli/utils/theme.js";
import { printUpgradeNotificationIfAvailable } from "@/cli/utils/upgradeNotification.js";
import { isLoggedIn } from "@/core/auth/index.js";
import { isCLIError } from "@/core/errors.js";
import { initAppConfig } from "@/core/project/index.js";

export interface RunCommandOptions {
  /**
   * Use the full ASCII art banner instead of the simple intro tag.
   * Useful for commands like `create` that want more visual impact.
   * @default false
   */
  fullBanner?: boolean;
  /**
   * Require user authentication before running this command.
   * If the user is not logged in, they will see an error message.
   * @default false
   */
  requireAuth?: boolean;
  /**
   * Initialize app config before running this command.
   * Reads .app.jsonc and caches the appId for sync access via getAppConfig().
   * @default true
   */
  requireAppConfig?: boolean;
}

export interface RunCommandResult {
  outroMessage?: string;
}

/**
 * Wraps a command function with the Base44 intro/outro and error handling.
 * All CLI commands should use this utility to ensure consistent branding.
 *
 * **Important**: Commands should NOT call `intro()` or `outro()` directly.
 * This function handles both. Commands can return an optional `outroMessage`
 * which will be displayed at the end.
 *
 * @param commandFn - The async function to execute. Returns `RunCommandResult` with optional `outroMessage`.
 * @param options - Optional configuration for the command wrapper
 * @param context - CLI context with dependencies (errorReporter, etc.)
 *
 * @example
 * export function getMyCommand(context: CLIContext): Command {
 *   return new Command("my-command")
 *     .action(async () => {
 *       await runCommand(
 *         async () => {
 *           // ... do work ...
 *           return { outroMessage: "Done!" };
 *         },
 *         { requireAuth: true },
 *         context
 *       );
 *     });
 * }
 */
export async function runCommand(
  commandFn: () => Promise<RunCommandResult>,
  options: RunCommandOptions | undefined,
  context: CLIContext
): Promise<void> {
  console.log();

  if (options?.fullBanner) {
    await printBanner();
    intro("");
  } else {
    intro(theme.colors.base44OrangeBackground(" Base 44 "));
  }

  await printUpgradeNotificationIfAvailable();

  try {
    // Check authentication if required
    if (options?.requireAuth) {
      const loggedIn = await isLoggedIn();

      if (!loggedIn) {
        log.info("You need to login first to continue.");
        await login();
      }
    }

    // Initialize app config unless explicitly disabled
    if (options?.requireAppConfig !== false) {
      const appConfig = await initAppConfig();
      context.errorReporter.setContext({ appId: appConfig.id });
    }

    const { outroMessage } = await commandFn();
    outro(outroMessage || "");
  } catch (error) {
    // Display error message
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(errorMessage);

    // Show stack trace if DEBUG mode
    if (process.env.DEBUG === "1" && error instanceof Error && error.stack) {
      log.error(theme.styles.dim(error.stack));
    }

    // Display hints if this is a CLIError with hints
    if (isCLIError(error)) {
      const hints = theme.format.agentHints(error.hints);
      if (hints) {
        log.error(hints);
      }
    }

    // Get error context and display in outro
    const errorContext = context.errorReporter.getErrorContext();
    outro(theme.format.errorContext(errorContext));

    // Re-throw for runCLI to handle (error reporting, exit code)
    throw error;
  }
}
