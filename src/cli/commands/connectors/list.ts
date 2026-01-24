import { Command } from "commander";
import { log } from "@clack/prompts";
import { listConnectors, getIntegrationDisplayName } from "@core/connectors/index.js";
import type { Connector } from "@core/connectors/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import { theme } from "../../utils/theme.js";

function formatConnectorLine(connector: Connector): string {
  const name = getIntegrationDisplayName(connector.integrationType);
  const account = connector.accountInfo?.email || connector.accountInfo?.name;
  const status = connector.status.toLowerCase();

  const bullet = status === "active" ? theme.colors.success("●") : theme.colors.error("○");
  const accountPart = account ? ` - ${account}` : "";
  const statusPart = status !== "active" ? theme.styles.dim(` (${status})`) : "";

  return `${bullet} ${name}${accountPart}${statusPart}`;
}

export async function listConnectorsCommand(): Promise<RunCommandResult> {
  const connectors = await runTask(
    "Fetching connectors...",
    async () => {
      return await listConnectors();
    },
    {
      successMessage: "Connectors loaded",
      errorMessage: "Failed to fetch connectors",
    }
  );

  if (connectors.length === 0) {
    log.info("No connectors configured for this app.");
    log.info(`Run ${theme.styles.bold("base44 connectors:add")} to connect an integration.`);
    return { outroMessage: "" };
  }

  console.log();
  for (const connector of connectors) {
    console.log(formatConnectorLine(connector));
  }
  console.log();

  return {
    outroMessage: `${connectors.length} connector${connectors.length === 1 ? "" : "s"} configured`,
  };
}

export const connectorsListCommand = new Command("connectors:list")
  .description("List all connected OAuth integrations")
  .action(async () => {
    await runCommand(listConnectorsCommand, {
      requireAuth: true,
      requireAppConfig: true,
    });
  });
