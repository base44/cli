import { release, type } from "node:os";
import { determineAgent } from "@vercel/detect-agent";
import { nanoid } from "nanoid";
import { isCLIError, isUserError } from "@/core/errors.js";
import packageJson from "../../../package.json";
import { getPostHogClient, isTelemetryEnabled } from "./posthog.js";

/**
 * Context that can be set during CLI execution.
 */
export interface ErrorContext {
  sessionId?: string;
  user?: {
    email: string;
    name?: string;
  };
  command?: {
    name: string;
    args: string[];
    options: Record<string, unknown>;
  };
  appId?: string;
  api?: {
    statusCode?: number;
    errorBody?: unknown;
  };
}

export class ErrorReporter {
  private sessionId = nanoid(12);
  private sessionStartedAt = new Date();
  private context: ErrorContext = {};
  private agentInfo: { isAgent: boolean; name: string | null } | null = null;

  constructor() {
    this.detectAgent();
  }

  private detectAgent(): void {
    determineAgent()
      .then((result) => {
        this.agentInfo = {
          isAgent: result.isAgent,
          name: result.isAgent ? result.agent.name : null,
        };
      })
      .catch(() => {
        // Agent detection is optional
      });
  }

  /**
   * Get the session ID for this CLI execution.
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Set context for error reporting. Can be called multiple times to add/update context.
   */
  setContext(context: ErrorContext): void {
    Object.assign(this.context, context);
  }

  private getDistinctId(): string {
    return this.context.user?.email ?? `anon-${this.sessionId}`;
  }

  private buildProperties(error?: Error): Record<string, unknown> {
    const { user, command, appId, api } = this.context;

    // Extract CLIError-specific properties if applicable
    const errorCode = error && isCLIError(error) ? error.code : undefined;
    const userError = error ? isUserError(error) : undefined;

    return {
      // Session
      session_id: this.sessionId,
      session_started_at: this.sessionStartedAt.toISOString(),
      execution_duration_ms: Date.now() - this.sessionStartedAt.getTime(),

      // User (PostHog person properties)
      ...(user && { $set: { email: user.email, name: user.name } }),

      // Command
      command_name: command?.name,
      command_args: command?.args,
      command_options: command?.options,

      // App
      app_id: appId,

      // Error context (from CLIError)
      ...(errorCode !== undefined && {
        error_code: errorCode,
        is_user_error: userError,
      }),

      // API error
      api_status_code: api?.statusCode,
      api_error_body: api?.errorBody,

      // System
      cli_version: packageJson.version,
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      os_release: release(),
      os_type: type(),

      // Environment
      is_tty: Boolean(process.stdout.isTTY),
      cwd: process.cwd(),

      // Agent
      is_agent: this.agentInfo?.isAgent,
      agent_name: this.agentInfo?.name,
    };
  }

  /**
   * Get error context for display purposes.
   * Returns session ID and current error context.
   */
  getErrorContext(): ErrorContext {
    return {
      sessionId: this.sessionId,
      ...this.context,
    };
  }

  /**
   * Capture an exception and report it to PostHog.
   * Includes error code and isUserError for CLIError instances.
   * Safe to call - never throws, logs errors to console.
   */
  captureException(error: Error): void {
    if (!isTelemetryEnabled()) {
      return;
    }

    try {
      const client = getPostHogClient();
      client?.captureException(
        error,
        this.getDistinctId(),
        this.buildProperties(error)
      );
    } catch {
      // Silent - don't let error reporting break the CLI
    }
  }

  /**
   * Register process-level error handlers for uncaught exceptions.
   */
  registerProcessErrorHandlers(): void {
    const handleError = (error: Error): void => {
      this.captureException(error);
      console.error(error);
      process.exitCode = 1;
    };

    process.on("uncaughtException", handleError);
    process.on("unhandledRejection", (reason) => {
      handleError(reason instanceof Error ? reason : new Error(String(reason)));
    });
  }
}
