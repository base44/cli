import { confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { removeDomain } from "@/core/domains/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { toJsonStdout } from "./shared.js";

interface RemoveOptions {
  yes?: boolean;
}

async function removeDomainAction(
  { runTask, jsonMode, isNonInteractive }: CLIContext,
  hostname: string,
  options: RemoveOptions,
): Promise<RunCommandResult> {
  if (isNonInteractive && !options.yes) {
    throw new InvalidInputError("--yes is required in non-interactive mode");
  }

  if (!options.yes) {
    const shouldRemove = await confirm({
      message: `Disconnect ${hostname} from this app?`,
    });
    if (isCancel(shouldRemove) || !shouldRemove) {
      return { outroMessage: "Removal cancelled" };
    }
  }

  const result = await runTask(
    `Removing ${hostname}...`,
    async () => await removeDomain(hostname),
    { errorMessage: "Failed to remove domain" },
  );

  return {
    outroMessage: `Disconnected ${hostname}`,
    stdout: jsonMode ? toJsonStdout(result) : undefined,
  };
}

export function getDomainsRemoveCommand(): Command {
  return new Base44Command("remove")
    .description("Disconnect a custom domain from this app")
    .argument("<hostname>", "Domain to disconnect")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(removeDomainAction);
}
