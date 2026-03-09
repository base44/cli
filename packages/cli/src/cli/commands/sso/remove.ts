import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { getAuthConfig, removeSSOConfig } from "@/core/auth-config/index.js";

async function removeSSOAction(): Promise<RunCommandResult> {
  const current = await runTask(
    "Fetching current auth config",
    async () => await getAuthConfig(),
  );

  if (!current.enableSSOLogin) {
    log.warn("SSO is not currently enabled for this app.");
    return { outroMessage: "No changes made" };
  }

  log.info(
    `Removing SSO provider: ${theme.styles.bold(current.ssoProviderName ?? "unknown")}`,
  );

  await runTask(
    "Removing SSO configuration",
    async () => await removeSSOConfig(),
  );

  return { outroMessage: "SSO has been disabled and credentials removed" };
}

export function getSSORemoveCommand(context: CLIContext): Command {
  return new Command("remove")
    .description("Remove SSO identity provider configuration")
    .action(async () => {
      await runCommand(removeSSOAction, { requireAuth: true }, context);
    });
}
