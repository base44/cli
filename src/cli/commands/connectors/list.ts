import { Command } from "commander";
import { log } from "@clack/prompts";
import {
  listConnectors,
  readLocalConnectors,
  getIntegrationDisplayName,
} from "@core/connectors/index.js";
import type { Connector, LocalConnector } from "@core/connectors/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import { theme } from "../../utils/theme.js";

interface MergedConnector {
  type: string;
  displayName: string;
  inLocal: boolean;
  inBackend: boolean;
  status?: string;
  accountEmail?: string;
}

function mergeConnectors(
  local: LocalConnector[],
  backend: Connector[]
): MergedConnector[] {
  const merged = new Map<string, MergedConnector>();

  // Add local connectors
  for (const connector of local) {
    merged.set(connector.type, {
      type: connector.type,
      displayName: getIntegrationDisplayName(connector.type),
      inLocal: true,
      inBackend: false,
    });
  }

  // Add/update with backend connectors
  for (const connector of backend) {
    const existing = merged.get(connector.integrationType);
    if (existing) {
      existing.inBackend = true;
      existing.status = connector.status;
      existing.accountEmail = connector.accountInfo?.email || connector.accountInfo?.name;
    } else {
      merged.set(connector.integrationType, {
        type: connector.integrationType,
        displayName: getIntegrationDisplayName(connector.integrationType),
        inLocal: false,
        inBackend: true,
        status: connector.status,
        accountEmail: connector.accountInfo?.email || connector.accountInfo?.name,
      });
    }
  }

  return Array.from(merged.values());
}

function formatConnectorLine(connector: MergedConnector): string {
  const { displayName, inLocal, inBackend, status, accountEmail } = connector;

  // Determine state
  const isConnected = inBackend && status?.toLowerCase() === "active";
  const isPending = inLocal && !inBackend;
  const isOrphaned = inBackend && !inLocal;

  // Build the line
  let bullet: string;
  let statusText = "";

  if (isConnected) {
    bullet = theme.colors.success("●");
    if (accountEmail) {
      statusText = ` - ${accountEmail}`;
    }
  } else if (isPending) {
    bullet = theme.colors.warning("○");
    statusText = theme.styles.dim(" (not connected)");
  } else if (isOrphaned) {
    bullet = theme.colors.error("○");
    statusText = theme.styles.dim(" (not in local config)");
  } else {
    bullet = theme.colors.error("○");
    statusText = theme.styles.dim(` (${status || "disconnected"})`);
  }

  return `${bullet} ${displayName}${statusText}`;
}

export async function listConnectorsCommand(): Promise<RunCommandResult> {
  // Fetch both local and backend connectors in parallel
  const [localConnectors, backendConnectors] = await runTask(
    "Fetching connectors...",
    async () => {
      const [local, backend] = await Promise.all([
        readLocalConnectors().catch(() => [] as LocalConnector[]),
        listConnectors().catch(() => [] as Connector[]),
      ]);
      return [local, backend] as const;
    },
    {
      successMessage: "Connectors loaded",
      errorMessage: "Failed to fetch connectors",
    }
  );

  const merged = mergeConnectors(localConnectors, backendConnectors);

  if (merged.length === 0) {
    log.info("No connectors configured for this app.");
    log.info(`Run ${theme.styles.bold("base44 connectors:add")} to connect an integration.`);
    return { outroMessage: "" };
  }

  console.log();
  for (const connector of merged) {
    console.log(formatConnectorLine(connector));
  }
  console.log();

  // Summary
  const connected = merged.filter((c) => c.inBackend && c.status?.toLowerCase() === "active").length;
  const pending = merged.filter((c) => c.inLocal && !c.inBackend).length;

  let summary = `${connected} connected`;
  if (pending > 0) {
    summary += `, ${pending} pending`;
    log.info(`Run ${theme.styles.bold("base44 connectors:push")} to connect pending integrations.`);
  }

  return { outroMessage: summary };
}

export const connectorsListCommand = new Command("connectors:list")
  .description("List all connected OAuth integrations")
  .action(async () => {
    await runCommand(listConnectorsCommand, {
      requireAuth: true,
      requireAppConfig: true,
    });
  });
