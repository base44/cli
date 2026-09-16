import { login } from "@/cli/commands/auth/login-flow.js";
import type { CLIContext } from "@/cli/types.js";
import {
  hasWorkspaceApiKeyAuth,
  isLoggedIn,
  readAuth,
  seedAuthFromEnv,
} from "@/core/auth/index.js";
import { InternalError } from "@/core/errors.js";
import type { AppContext } from "@/core/project/index.js";
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

/**
 * The app this command resolved, narrowed.
 *
 * `CLIContext.app` is optional only because a handful of commands declare
 * `requireAppContext: false`. Every other command has already been through
 * {@link ensureAppContext}, which returns an app or throws — so for them the
 * absent case is unreachable, and the optional type is what is inaccurate.
 *
 * Use this rather than defaulting at the call site. An app id substituted with
 * `""` is not a missing value the build reports: Vite inlines it, so the build
 * and the publish both succeed and the served app addresses no app at all.
 */
export function requireApp(ctx: Pick<CLIContext, "app">): AppContext {
  if (!ctx.app) {
    throw new InternalError(
      "This command read an app context it never resolved — it is declared with requireAppContext: false.",
    );
  }
  return ctx.app;
}
