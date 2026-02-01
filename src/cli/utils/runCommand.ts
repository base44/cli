import { intro, log, outro } from "@clack/prompts";
import type { CLIContext } from "@/cli/types.js";
import { Base44LocalProjectSDK } from "@/core/index.js";
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
   * Creates SDK instance and makes it available via context.sdk.
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
 * @param commandFn - The async function to execute. Receives the SDK instance (if requireAppConfig is true).
 * @param options - Optional configuration for the command wrapper
 * @param context - CLI context with dependencies (errorReporter, sdk, etc.)
 *
 * @example
 * export function getMyCommand(context: CLIContext): Command {
 *   return new Command("my-command")
 *     .action(async () => {
 *       await runCommand(
 *         async (sdk) => {
 *           const entities = await sdk.entities.readAll();
 *           await sdk.entities.push(entities);
 *           return { outroMessage: "Done!" };
 *         },
 *         { requireAuth: true },
 *         context
 *       );
 *     });
 * }
 */
export async function runCommand(
  commandFn: (sdk: Base44LocalProjectSDK) => Promise<RunCommandResult>,
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
      const loggedIn = await Base44LocalProjectSDK.auth.isLoggedIn();

      if (!loggedIn) {
        log.info("You need to login first to continue.");
        await login();
      }
    }

    // Initialize SDK unless explicitly disabled
    let sdk = context.sdk;
    if (options?.requireAppConfig !== false && !sdk) {
      sdk = await Base44LocalProjectSDK.fromCurrentDirectory();
      context.sdk = sdk;
      context.errorReporter.setContext({ appId: sdk.config.appId });
    }

    // For commands that don't need app config, sdk may be null
    // The command function signature accepts sdk but may not use it
    const { outroMessage } = await commandFn(sdk as Base44LocalProjectSDK);
    outro(outroMessage || "");
  } catch (error) {
    // Display error with nice formatting, then re-throw for runCLI to handle
    log.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    throw error;
  }
}
