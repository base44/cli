import { log } from "@clack/prompts";
import { login } from "@/cli/commands/auth/login-flow.js";
import type { ErrorReporter } from "@/cli/telemetry/error-reporter.js";
import { isLoggedIn, readAuth } from "@/core/auth/index.js";
import { initAppConfig } from "@/core/project/index.js";

/**
 * Check authentication status and trigger login flow if needed.
 * Sets user context on the error reporter after successful auth.
 */
export async function ensureAuth(errorReporter: ErrorReporter): Promise<void> {
  const loggedIn = await isLoggedIn();

  if (!loggedIn) {
    log.info("You need to login first to continue.");
    await login();
  }

  try {
    const userInfo = await readAuth();
    errorReporter.setContext({
      user: { email: userInfo.email, name: userInfo.name },
    });
  } catch {
    // User info is optional context for error reporting
  }
}

/**
 * Load app config (.app.jsonc) and set appId on the error reporter.
 */
export async function ensureAppConfig(
  errorReporter: ErrorReporter,
): Promise<void> {
  const appConfig = await initAppConfig();
  errorReporter.setContext({ appId: appConfig.id });
}
