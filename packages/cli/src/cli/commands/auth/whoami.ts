import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { readAuth } from "@/core/auth/index.js";

async function whoami(_ctx: CLIContext): Promise<RunCommandResult> {
  const auth = await readAuth();
  return { outroMessage: `Logged in as: ${theme.styles.bold(auth.email)}` };
}

export function getWhoamiCommand(): Command {
  return new Base44Command("whoami", { requireAppContext: false })
    .description("Display current authenticated user")
    .action(whoami);
}
