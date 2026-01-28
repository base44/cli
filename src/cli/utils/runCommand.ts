import { intro, log, outro } from "@clack/prompts";
import { isLoggedIn, readAuth } from "@/core/auth/index.js";
import { initAppConfig, getAppConfig } from "@/core/project/index.js";
import { CLIExitError } from "@/cli/errors.js";
import { printBanner } from "@/cli/utils/banner.js";
import { login } from "@/cli/commands/auth/login.js";
import { theme } from "@/cli/utils/theme.js";
import {
  trackCommandStarted,
  trackCommandCompleted,
} from "@/core/telemetry/index.js";

export interface TelemetryOptions {
  /**
   * The main command name (e.g., "deploy", "create", "login")
   */
  command: string;
  /**
   * The sub-command name if applicable (e.g., "push" for "agents push")
   */
  subCommand?: string;
  /**
   * The flow name for tracking user journeys
   */
  flow?: string;
  /**
   * Additional context about the command execution
   */
  additionalInfo?: string;
}

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
  /**
   * Telemetry options for tracking command execution.
   * If not provided, the command will not be tracked.
   */
  telemetry?: TelemetryOptions;
}

export interface RunCommandResult {
  outroMessage?: string;
};

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
 *
 * @example
 * // Standard command with outro message
 * async function myAction(): Promise<RunCommandResult> {
 *   // ... do work ...
 *   return { outroMessage: "Done!" };
 * }
 *
 * export const myCommand = new Command("my-command")
 *   .action(async () => {
 *     await runCommand(myAction);
 *   });
 *
 * @example
 * // Command requiring authentication with full banner
 * export const myCommand = new Command("my-command")
 *   .action(async () => {
 *     await runCommand(myAction, { requireAuth: true, fullBanner: true });
 *   });
 */
export async function runCommand(
  commandFn: () => Promise<RunCommandResult>,
  options?: RunCommandOptions
): Promise<void> {
  const startTime = Date.now();
  let userId: string | undefined;
  let appId: string | undefined;

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

    // Try to get user ID for telemetry (non-blocking)
    try {
      const auth = await readAuth();
      userId = auth.email;
    } catch {
      // User not logged in, continue without user ID
    }

    // Initialize app config unless explicitly disabled
    if (options?.requireAppConfig !== false) {
      await initAppConfig();
    }

    // Try to get app ID for telemetry (non-blocking)
    try {
      const config = getAppConfig();
      appId = config.id;
    } catch {
      // App config not available, continue without app ID
    }

    // Track command started
    if (options?.telemetry) {
      trackCommandStarted({
        command: options.telemetry.command,
        subCommand: options.telemetry.subCommand,
        appId,
        userId,
        flow: options.telemetry.flow,
        additionalInfo: options.telemetry.additionalInfo,
      });
    }

    const { outroMessage } = await commandFn();

    // Track command completed successfully
    if (options?.telemetry) {
      trackCommandCompleted({
        command: options.telemetry.command,
        subCommand: options.telemetry.subCommand,
        appId,
        userId,
        flow: options.telemetry.flow,
        additionalInfo: options.telemetry.additionalInfo,
        success: true,
        durationMs: Date.now() - startTime,
        sessionEnd: "success",
      });
    }

    outro(outroMessage || "");
  } catch (e) {
    // Track command failure
    if (options?.telemetry) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      const sessionEnd = e instanceof CLIExitError ? "stopped" : "failed";

      trackCommandCompleted({
        command: options.telemetry.command,
        subCommand: options.telemetry.subCommand,
        appId,
        userId,
        flow: options.telemetry.flow,
        additionalInfo: options.telemetry.additionalInfo,
        success: false,
        durationMs: Date.now() - startTime,
        errorMessage,
        sessionEnd,
      });
    }

    // Pass through CLIExitError without logging (intentional exits, e.g., user cancellation)
    if (e instanceof CLIExitError) {
      throw e;
    }
    if (e instanceof Error) {
      log.error(e.stack ?? e.message);
    } else {
      log.error(String(e));
    }
    throw new CLIExitError(1);
  }
}
