import { Command } from "commander";
import { confirm, select, isCancel } from "@clack/prompts";
import {
  listConnectors,
  disconnectConnector,
  isValidIntegration,
  getIntegrationDisplayName,
} from "@core/connectors/index.js";
import type { IntegrationType, Connector } from "@core/connectors/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import { theme } from "../../utils/theme.js";

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
  integrationType?: string
): Promise<RunCommandResult> {
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

  // Confirm removal
  const shouldRemove = await confirm({
    message: `Disconnect ${displayName}${accountInfo}?`,
    initialValue: false,
  });

  if (isCancel(shouldRemove) || !shouldRemove) {
    return { outroMessage: "Cancelled" };
  }

  // Perform disconnection
  await runTask(
    `Disconnecting ${displayName}...`,
    async () => {
      await disconnectConnector(selectedType);
    },
    {
      successMessage: `${displayName} disconnected`,
      errorMessage: `Failed to disconnect ${displayName}`,
    }
  );

  return {
    outroMessage: `Successfully disconnected ${theme.styles.bold(displayName)}`,
  };
}

export const connectorsRemoveCommand = new Command("connectors:remove")
  .argument("[type]", "Integration type to remove (e.g., slack, notion)")
  .description("Disconnect an OAuth integration")
  .action(async (type?: string) => {
    await runCommand(() => removeConnectorCommand(type), {
      requireAuth: true,
      requireAppConfig: true,
    });
  });
