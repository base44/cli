import { Command } from "commander";
import { log } from "@clack/prompts";
import { listConnectors, getIntegrationDisplayName } from "@core/connectors/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import { theme } from "../../utils/theme.js";

function formatDate(dateString?: string): string {
  if (!dateString) {
    return "-";
  }
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateString;
  }
}

function formatStatus(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "active" || normalized === "connected") {
    return theme.colors.success("● active");
  }
  if (normalized === "expired") {
    return theme.colors.warning("● expired");
  }
  if (normalized === "failed" || normalized === "disconnected") {
    return theme.colors.error("● disconnected");
  }
  return status;
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

  // Display as formatted list
  console.log();
  console.log(theme.styles.bold("Connected Integrations:"));
  console.log();

  // Table header
  const headers = ["Type", "Account", "Status", "Connected"];
  const colWidths = [20, 30, 15, 15];

  const headerRow = headers
    .map((h, i) => h.padEnd(colWidths[i]))
    .join(" ");
  console.log(theme.styles.dim(headerRow));
  console.log(theme.styles.dim("─".repeat(headerRow.length)));

  // Table rows
  for (const connector of connectors) {
    const type = getIntegrationDisplayName(connector.integrationType).padEnd(colWidths[0]);
    const account = (connector.accountInfo?.email || connector.accountInfo?.name || "-").padEnd(colWidths[1]);
    const status = formatStatus(connector.status);
    const connected = formatDate(connector.connectedAt).padEnd(colWidths[3]);

    // Status has ANSI codes so we handle it separately
    console.log(`${type} ${account} ${status.padEnd(colWidths[2] + 10)} ${connected}`);
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
