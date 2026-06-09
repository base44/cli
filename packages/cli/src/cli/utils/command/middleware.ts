import { login } from "@/cli/commands/auth/login-flow.js";
import type { CLIContext } from "@/cli/types.js";
import { isLoggedIn, readAuth, seedAuthFromEnv } from "@/core/auth/index.js";
import { initAppConfig } from "@/core/project/index.js";

/**
 * Check authentication status and trigger login flow if needed.
 * Sets user context on the error reporter after successful auth.
 */
export async function ensureAuth(ctx: CLIContext): Promise<void> {
  // Seed auth.json from env-supplied credentials (CI, agents, provisioning
  // tools) before the login check, so env tokens satisfy auth without a login.
  await seedAuthFromEnv();

  const loggedIn = await isLoggedIn();

  if (!loggedIn) {
    ctx.log.info("You need to login first to continue.");
    await login(ctx);
  }

  try {
    const userInfo = await readAuth();
    ctx.errorReporter.setContext({
      user: { email: userInfo.email, name: userInfo.name },
    });
  } catch {
    // User info is optional context for error reporting
  }
}

/**
 * Load app config (.app.jsonc) and set appId on the error reporter.
 */
export async function ensureAppConfig(ctx: CLIContext): Promise<void> {
  const appConfig = await initAppConfig();
  ctx.errorReporter.setContext({ appId: appConfig.id });
}
