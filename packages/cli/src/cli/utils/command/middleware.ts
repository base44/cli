import { login } from "@/cli/commands/auth/login-flow.js";
import type { CLIContext } from "@/cli/types.js";
import {
  hasWorkspaceApiKeyAuth,
  isLoggedIn,
  readAuth,
  seedAuthFromEnv,
} from "@/core/auth/index.js";
import { initAppContext } from "@/core/project/index.js";

/**
 * Check authentication status and trigger login flow if needed.
 * Sets user context on the error reporter after successful auth.
 */
export async function ensureAuth(ctx: CLIContext): Promise<void> {
  if (hasWorkspaceApiKeyAuth()) {
    ctx.errorReporter.setContext({
      user: { email: "workspace-api-key", name: "Workspace API key" },
    });
    return;
  }

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
 * Resolve the active app context and set appId on the error reporter.
 */
export async function ensureAppContext(
  ctx: CLIContext,
  options: { appId?: string } = {},
): Promise<void> {
  const appContext = await initAppContext(options);
  ctx.app = appContext;
  ctx.errorReporter.setContext({ appId: appContext.id });
}
