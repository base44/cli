import { release, type } from "node:os";
import { nanoid } from "nanoid";
import { determineAgent } from "@vercel/detect-agent";
import { getPostHogClient, isTelemetryEnabled } from "./posthog.js";
import packageJson from "../../../package.json";

/**
 * User context from auth file.
 */
interface UserContext {
  email: string;
  name?: string;
}

/**
 * Command context from Commander.
 */
interface CommandContext {
  name: string;
  args: string[];
  options: Record<string, unknown>;
}

/**
 * API error context for debugging Base44 API failures.
 */
interface ApiErrorContext {
  statusCode?: number;
  errorBody?: unknown;
}

/**
 * Agent context for AI agent detection.
 */
interface AgentContext {
  isAgent: boolean;
  name: string | null;
}

/**
 * Full context accumulated during CLI execution.
 */
interface ErrorReporterContext {
  user?: UserContext;
  command?: CommandContext;
  session: { id: string; startedAt: Date };
  app?: { id: string };
  api?: ApiErrorContext;
  agent?: AgentContext;
  custom: Record<string, unknown>;
}

class ErrorReporter {
  private context: ErrorReporterContext;

  constructor() {
    this.context = {
      session: { id: nanoid(12), startedAt: new Date() },
      custom: {},
    };

    this.detectAgent();
  }

  private detectAgent(): void {
    determineAgent()
      .then((result) => {
        this.context.agent = {
          isAgent: result.isAgent,
          name: result.isAgent ? result.agent.name : null,
        };
      })
      .catch(() => {
        // Ignore detection errors - agent info is optional
      });
  }

  get sessionId(): string {
    return this.context.session.id;
  }

  setUser(user: UserContext): void {
    this.context.user = user;
  }

  setCommand(command: CommandContext): void {
    this.context.command = command;
  }

  setAppContext(appId: string): void {
    this.context.app = { id: appId };
  }

  setApiError(statusCode: number, errorBody?: unknown): void {
    this.context.api = { statusCode, errorBody };
  }

  setContext(key: string, value: unknown): void {
    this.context.custom[key] = value;
  }

  private getDistinctId(): string {
    return this.context.user?.email || "anonymous-cli-user";
  }

  private buildProperties(): Record<string, unknown> {
    const executionDurationMs = Date.now() - this.context.session.startedAt.getTime();

    return {
      // Session context
      session_id: this.context.session.id,
      session_started_at: this.context.session.startedAt.toISOString(),
      execution_duration_ms: executionDurationMs,

      // User context (also set via $set for person properties)
      ...(this.context.user && {
        $set: {
          email: this.context.user.email,
          name: this.context.user.name,
        },
      }),

      // Command context
      ...(this.context.command && {
        command_name: this.context.command.name,
        command_args: this.context.command.args,
        command_options: this.context.command.options,
      }),

      // App context
      ...(this.context.app && {
        app_id: this.context.app.id,
      }),

      // API error context
      ...(this.context.api && {
        api_status_code: this.context.api.statusCode,
        api_error_body: this.context.api.errorBody,
      }),

      // System context
      cli_version: packageJson.version,
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      os_release: release(),
      os_type: type(),

      // Environment context
      is_tty: Boolean(process.stdout.isTTY),
      cwd: process.cwd(),

      // Agent context
      ...(this.context.agent && {
        is_agent: this.context.agent.isAgent,
        agent_name: this.context.agent.name,
      }),

      // Custom context
      ...this.context.custom,
    };
  }

  displayErrorInfo(): void {
    const info = [
      "",
      "--- Error Details ---",
      `Session:     ${this.context.session.id}`,
      `App ID:      ${this.context.app?.id || "N/A"}`,
      `Command:     ${this.context.command?.name || "N/A"}`,
      `CLI Version: ${packageJson.version}`,
      `Time:        ${new Date().toISOString()}`,
      "---------------------",
      "",
    ];
    console.error(info.join("\n"));
  }

  /**
   * Capture an exception and report it to PostHog.
   * Safe to call - never throws, logs errors to console.
   */
  captureException(error: Error) {
    if (!isTelemetryEnabled()) {
      return;
    }

    try {
      const client = getPostHogClient();
      if (!client) {
        return;
      }

      client.captureException(error, this.getDistinctId(), this.buildProperties());
    } catch {
      // Silent - don't let error reporting break the CLI
    }
  }

  /**
   * Register process-level error handlers for uncaught exceptions.
   * Should be called early in CLI startup.
   */
  registerProcessErrorHandlers(): void {
    const handleError = (error: Error): void => {
      this.displayErrorInfo();
      // Fire-and-forget: captureException queues the event, PostHog flushes immediately
      this.captureException(error);
      console.error(error);
      // Use exitCode instead of exit() to let event loop drain and allow pending requests to complete
      process.exitCode = 1;
    };

    process.on("uncaughtException", (error) => {
      handleError(error);
    });

    process.on("unhandledRejection", (reason) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      handleError(error);
    });
  }
}

// Singleton instance - created at module load
export const errorReporter = new ErrorReporter();
