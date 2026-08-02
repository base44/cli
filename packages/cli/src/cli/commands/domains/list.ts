import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { listDomains } from "@/core/domains/index.js";
import { formatDomainLine, toJsonStdout } from "./shared.js";

async function listDomainsAction({
  log,
  runTask,
  jsonMode,
}: CLIContext): Promise<RunCommandResult> {
  const domains = await runTask(
    "Fetching domains...",
    async () => await listDomains(),
    { errorMessage: "Failed to fetch domains" },
  );

  if (jsonMode) {
    return {
      outroMessage: `${domains.length} domains`,
      stdout: toJsonStdout({ domains }),
    };
  }

  if (domains.length === 0) {
    return { outroMessage: "No custom domains found" };
  }

  for (const domain of domains) {
    log.message(formatDomainLine(domain));
  }

  return {
    outroMessage: `${domains.length} domain${domains.length !== 1 ? "s" : ""}`,
  };
}

export function getDomainsListCommand(): Command {
  return new Base44Command("list")
    .description("List custom domains connected to this app")
    .action(listDomainsAction);
}
