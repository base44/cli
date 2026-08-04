import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import type { Domain } from "@/core/domains/index.js";
import { addDomain, waitForDomainActive } from "@/core/domains/index.js";
import { domainStatusText, logDomainSetup, toJsonStdout } from "./shared.js";

interface AddOptions {
  wait?: boolean;
}

function waitMessage(domain: Domain | undefined): string {
  if (!domain) return "Waiting for domain to appear...";
  return `Waiting for domain to become active (${domainStatusText(domain)})...`;
}

async function addDomainAction(
  { log, runTask, jsonMode }: CLIContext,
  hostname: string,
  options: AddOptions,
): Promise<RunCommandResult> {
  let domain = await runTask(
    `Connecting ${hostname}...`,
    async () => await addDomain(hostname),
    { errorMessage: "Failed to connect domain" },
  );

  if (options.wait && !domain.active) {
    domain = await runTask(
      waitMessage(domain),
      async (updateMessage) =>
        await waitForDomainActive(hostname, {
          onTick: (d) => updateMessage(waitMessage(d)),
        }),
      {
        successMessage: `${hostname} is active`,
        errorMessage: "Domain did not become active",
      },
    );
  }

  if (jsonMode) {
    return {
      outroMessage: `Domain ${hostname} is ${domainStatusText(domain)}`,
      stdout: toJsonStdout(domain),
    };
  }

  logDomainSetup(domain, log);
  return {
    outroMessage: domain.active
      ? `${hostname} is active`
      : `${hostname} connected — add the CNAME record above to finish`,
  };
}

export function getDomainsAddCommand(): Command {
  return new Base44Command("add")
    .description("Connect a custom domain to this app")
    .argument("<hostname>", "Domain to connect, e.g. app.example.com")
    .option(
      "--wait",
      "Poll until the domain and its TLS certificate are active",
    )
    .action(addDomainAction);
}
