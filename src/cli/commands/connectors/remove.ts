import { Command } from "commander";
import { cancel, confirm, select, isCancel } from "@clack/prompts";
import {
  listConnectors,
  disconnectConnector,
  removeConnector,
  isValidIntegration,
  getIntegrationDisplayName,
} from "@/core/connectors/index.js";
import type { IntegrationType, Connector } from "@/core/connectors/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import { theme } from "../../utils/theme.js";

interface RemoveOptions {
  hard?: boolean;
  yes?: boolean;
}

interface ConnectorInfo {
  type: IntegrationType;
  displayName: string;
  accountEmail?: string;
}

function mapBackendConnectors(connectors: Connector[]): ConnectorInfo[] {
  return connectors
    .filter((c) => isValidIntegration(c.integrationType))
    .map((c) => ({
      type: c.integrationType,
      displayName: getIntegrationDisplayName(c.integrationType),
      accountEmail: (c.accountInfo?.email || c.accountInfo?.name) ?? undefined,
    }));
}

function validateConnectorType(
  type: string,
  connectors: ConnectorInfo[]
): ConnectorInfo {
  if (!isValidIntegration(type)) {
    throw new Error(`Invalid connector type: ${type}`);
  }

  const connector = connectors.find((c) => c.type === type);
  if (!connector) {
    throw new Error(`No ${getIntegrationDisplayName(type)} connector found`);
  }

  return connector;
}

async function promptForConnectorToRemove(
  connectors: ConnectorInfo[]
): Promise<ConnectorInfo> {
  const options = connectors.map((c) => {
    let label = c.displayName;
    if (c.accountEmail) {
      label += ` (${c.accountEmail})`;
    }
    return {
      value: c.type,
      label,
    };
  });

  const selected = await select({
    message: "Select a connector to remove:",
    options,
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }

  return connectors.find((c) => c.type === selected)!;
}

export async function removeConnectorCommand(
  integrationType?: string,
  options: RemoveOptions = {}
): Promise<RunCommandResult> {
  const isHardDelete = options.hard === true;

  // Fetch backend connectors
  const backendConnectors = await runTask(
    "Fetching connectors...",
    async () => listConnectors(),
    {
      successMessage: "Connectors loaded",
      errorMessage: "Failed to fetch connectors",
    }
  );

  const connectors = mapBackendConnectors(backendConnectors);

  if (connectors.length === 0) {
    return {
      outroMessage: "No connectors to remove",
    };
  }

  // Get type from argument or prompt
  const selectedConnector = integrationType
    ? validateConnectorType(integrationType, connectors)
    : await promptForConnectorToRemove(connectors);

  const displayName = selectedConnector.displayName;
  const accountInfo = selectedConnector.accountEmail
    ? ` (${selectedConnector.accountEmail})`
    : "";

  // Confirm removal (skip if --yes flag is provided)
  if (!options.yes) {
    const actionWord = isHardDelete ? "Permanently remove" : "Remove";
    const shouldRemove = await confirm({
      message: `${actionWord} ${displayName}${accountInfo}?`,
      initialValue: false,
    });

    if (isCancel(shouldRemove) || !shouldRemove) {
      cancel("Operation cancelled.");
      process.exit(0);
    }
  }

  // Perform removal
  await runTask(
    `Removing ${displayName}...`,
    async () => {
      if (isHardDelete) {
        await removeConnector(selectedConnector.type);
      } else {
        await disconnectConnector(selectedConnector.type);
      }
    },
    {
      successMessage: `${displayName} removed`,
      errorMessage: `Failed to remove ${displayName}`,
    }
  );

  return {
    outroMessage: `Successfully removed ${theme.styles.bold(displayName)}`,
  };
}

export const connectorsRemoveCommand = new Command("remove")
  .argument("[type]", "Integration type to remove (e.g., slack, notion)")
  .option("--hard", "Permanently remove the connector (cannot be undone)")
  .option("-y, --yes", "Skip confirmation prompt")
  .description("Remove an OAuth integration")
  .action(async (type: string | undefined, options: RemoveOptions) => {
    await runCommand(() => removeConnectorCommand(type, options), {
      requireAuth: true,
      requireAppConfig: true,
    });
  });
