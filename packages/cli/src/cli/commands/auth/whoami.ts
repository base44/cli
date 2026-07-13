import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import {
  getWorkspaceApiKeyFromEnv,
  isWorkspaceApiKey,
  readAuth,
} from "@/core/auth/index.js";

async function whoami(_ctx: CLIContext): Promise<RunCommandResult> {
  const workspaceApiKey = getWorkspaceApiKeyFromEnv();
  if (workspaceApiKey && isWorkspaceApiKey(workspaceApiKey)) {
    return {
      outroMessage: `Using workspace API key: ${theme.styles.bold(workspaceApiKey.slice(0, 10))}`,
    };
  }

  const auth = await readAuth();
  return { outroMessage: `Logged in as: ${theme.styles.bold(auth.email)}` };
}

export function getWhoamiCommand(): Command {
  return new Base44Command("whoami", { requireAppContext: false })
    .description("Display current authenticated user")
    .action(whoami);
}
