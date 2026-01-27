import { PostHog } from "posthog-node";

/**
 * Error reporter using PostHog for CLI executions.
 * Designed for short-running CLI tools with proper shutdown handling.
 */
class ErrorReporter {
  private client: PostHog | null = null;
  private isEnabled = false;
  private shutdownPromise: Promise<void> | null = null;

  /**
   * Initialize the error reporter with PostHog configuration.
   * @param apiKey - PostHog API key
   * @param host - PostHog host URL (optional, defaults to PostHog cloud)
   */
  initialize(apiKey: string, host?: string): void {
    if (!apiKey) {
      console.warn("PostHog API key not provided. Error reporting disabled.");
      return;
    }

    try {
      this.client = new PostHog(apiKey, {
        host: host || "https://us.i.posthog.com",
        // Disable batch processing for CLI - we want immediate sends
        flushAt: 1,
        flushInterval: 0,
      });
      this.isEnabled = true;
    } catch (error) {
      console.error("Failed to initialize PostHog client:", error);
      this.isEnabled = false;
    }
  }

  /**
   * Capture an exception and report it to PostHog.
   * @param error - The error to capture
   * @param context - Optional additional context about the error
   */
  async captureException(
    error: Error,
    context?: Record<string, unknown>
  ): Promise<void> {
    if (!this.isEnabled || !this.client) {
      return;
    }

    try {
      const properties: Record<string, unknown> = {
        error_name: error.name,
        error_message: error.message,
        error_stack: error.stack,
        ...context,
      };

      // Capture as an event with error details
      this.client.capture({
        distinctId: "cli-user", // For CLI, we use a generic ID unless user identification is added
        event: "cli_error",
        properties,
      });

      // For CLI tools, we need to flush immediately since the process may exit soon
      await this.client.flush();
    } catch (captureError) {
      // Don't let error reporting failures break the CLI
      console.error("Failed to capture exception:", captureError);
    }
  }

  /**
   * Shutdown the error reporter and ensure all events are sent.
   * MUST be called before CLI exits to ensure events are flushed.
   */
  async shutdown(): Promise<void> {
    if (!this.client || this.shutdownPromise) {
      // Already shutting down or no client
      return this.shutdownPromise || Promise.resolve();
    }

    this.shutdownPromise = (async () => {
      try {
        await this.client!.shutdown();
      } catch (error) {
        console.error("Error during PostHog shutdown:", error);
      } finally {
        this.isEnabled = false;
        this.client = null;
      }
    })();

    return this.shutdownPromise;
  }

  /**
   * Check if error reporting is enabled.
   */
  get enabled(): boolean {
    return this.isEnabled;
  }
}

// Export a singleton instance
export const errorReporter = new ErrorReporter();

// Export the class for testing purposes
export { ErrorReporter };
