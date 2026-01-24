import { Command } from "commander";
import { confirm, select, isCancel } from "@clack/prompts";
import {
  listConnectors,
  disconnectConnector,
  removeConnector,
  isValidIntegration,
  getIntegrationDisplayName,
} from "@core/connectors/index.js";
import type { IntegrationType, Connector } from "@core/connectors/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import { theme } from "../../utils/theme.js";

interface RemoveOptions {
  hard?: boolean;
}

async function promptForConnectorToRemove(
  connectors: Connector[]
): Promise<IntegrationType | null> {
  const options = connectors.map((c) => ({
    value: c.integrationType as IntegrationType,
    label: `${getIntegrationDisplayName(c.integrationType)}${c.accountInfo?.email ? ` (${c.accountInfo.email})` : ""}`,
  }));

  const selected = await select({
    message: "Select a connector to remove:",
    options,
  });

  if (isCancel(selected)) {
    return null;
  }

  return selected;
}

export async function removeConnectorCommand(
  integrationType?: string,
  options: RemoveOptions = {}
): Promise<RunCommandResult> {
  const isHardDelete = options.hard === true;

  // Fetch current connectors to validate selection
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
    return {
      outroMessage: "No connectors to remove",
    };
  }

  // If no type provided, prompt for selection
  let selectedType: IntegrationType;

  if (!integrationType) {
    const prompted = await promptForConnectorToRemove(connectors);
    if (!prompted) {
      return { outroMessage: "Cancelled" };
    }
    selectedType = prompted;
  } else {
    // Validate the provided integration type
    if (!isValidIntegration(integrationType)) {
      throw new Error(`Invalid connector type: ${integrationType}`);
    }

    // Check if this connector is actually connected
    const isConnected = connectors.some(
      (c) => c.integrationType === integrationType
    );
    if (!isConnected) {
      throw new Error(
        `No ${getIntegrationDisplayName(integrationType)} connector found for this app`
      );
    }

    selectedType = integrationType;
  }

  const displayName = getIntegrationDisplayName(selectedType);

  // Find connector info for display
  const connector = connectors.find((c) => c.integrationType === selectedType);
  const accountInfo = connector?.accountInfo?.email
    ? ` (${connector.accountInfo.email})`
    : "";

  // Confirm removal with appropriate message
  const actionWord = isHardDelete ? "Permanently remove" : "Disconnect";
  const shouldRemove = await confirm({
    message: `${actionWord} ${displayName}${accountInfo}?`,
    initialValue: false,
  });

  if (isCancel(shouldRemove) || !shouldRemove) {
    return { outroMessage: "Cancelled" };
  }

  // Perform disconnection or removal
  const taskMessage = isHardDelete
    ? `Removing ${displayName}...`
    : `Disconnecting ${displayName}...`;
  const successMessage = isHardDelete
    ? `${displayName} removed`
    : `${displayName} disconnected`;
  const errorMessage = isHardDelete
    ? `Failed to remove ${displayName}`
    : `Failed to disconnect ${displayName}`;

  await runTask(
    taskMessage,
    async () => {
      if (isHardDelete) {
        await removeConnector(selectedType);
      } else {
        await disconnectConnector(selectedType);
      }
    },
    {
      successMessage,
      errorMessage,
    }
  );

  const outroAction = isHardDelete ? "removed" : "disconnected";
  return {
    outroMessage: `Successfully ${outroAction} ${theme.styles.bold(displayName)}`,
  };
}

export const connectorsRemoveCommand = new Command("connectors:remove")
  .argument("[type]", "Integration type to remove (e.g., slack, notion)")
  .option("--hard", "Permanently remove the connector (cannot be undone)")
  .description("Disconnect an OAuth integration")
  .action(async (type: string | undefined, options: RemoveOptions) => {
    await runCommand(() => removeConnectorCommand(type, options), {
      requireAuth: true,
      requireAppConfig: true,
    });
  });
