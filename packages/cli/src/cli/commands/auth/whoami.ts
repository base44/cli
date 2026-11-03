import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import {
  getSessionUser,
  getWorkspaceApiKeyFromEnv,
  isLoggedIn,
  isWorkspaceApiKey,
  seedAuthFromEnv,
} from "@/core/auth/index.js";
import { AuthRequiredError } from "@/core/errors.js";

async function whoami(_ctx: CLIContext): Promise<RunCommandResult> {
  const workspaceApiKey = getWorkspaceApiKeyFromEnv();
  if (workspaceApiKey && isWorkspaceApiKey(workspaceApiKey)) {
    return {
      outroMessage: `Using workspace API key: ${theme.styles.bold(workspaceApiKey.slice(0, 10))}`,
    };
  }

  await seedAuthFromEnv();
  if (!(await isLoggedIn())) {
    throw new AuthRequiredError("Not logged in");
  }

  const user = await getSessionUser();
  return { outroMessage: `Logged in as: ${theme.styles.bold(user.email)}` };
}

export function getWhoamiCommand(): Command {
  return new Base44Command("whoami", {
    requireAuth: false,
    requireAppContext: false,
  })
    .description("Display current authenticated user")
    .action(whoami);
}
