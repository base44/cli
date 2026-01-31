import { intro, log, outro } from "@clack/prompts";
import type { CLIContext } from "@/cli/types.js";
import { isLoggedIn } from "@/core/auth/index.js";
import { initAppConfig } from "@/core/project/index.js";
import { login } from "@/cli/commands/auth/login-flow.js";
import { printBanner } from "@/cli/utils/banner.js";
import { theme } from "@/cli/utils/theme.js";

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
    // Display error with nice formatting, then re-throw for runCLI to handle
    log.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    throw error;
  }
}
