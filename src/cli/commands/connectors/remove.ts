import { Command } from "commander";
import { confirm, select, isCancel } from "@clack/prompts";
import {
  listConnectors,
  readLocalConnectors,
  removeLocalConnector,
  disconnectConnector,
  removeConnector,
  isValidIntegration,
  getIntegrationDisplayName,
} from "@core/connectors/index.js";
import type { IntegrationType, Connector, LocalConnector } from "@core/connectors/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import { theme } from "../../utils/theme.js";

interface RemoveOptions {
  hard?: boolean;
}

interface MergedConnector {
  type: IntegrationType;
  displayName: string;
  inLocal: boolean;
  inBackend: boolean;
  accountEmail?: string;
}

function mergeConnectorsForRemoval(
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
    if (!isValidIntegration(connector.integrationType)) {
      continue;
    }

    const existing = merged.get(connector.integrationType);
    if (existing) {
      existing.inBackend = true;
      existing.accountEmail = connector.accountInfo?.email || connector.accountInfo?.name;
    } else {
      merged.set(connector.integrationType, {
        type: connector.integrationType,
        displayName: getIntegrationDisplayName(connector.integrationType),
        inLocal: false,
        inBackend: true,
        accountEmail: connector.accountInfo?.email || connector.accountInfo?.name,
      });
    }
  }

  return Array.from(merged.values());
}

async function promptForConnectorToRemove(
  connectors: MergedConnector[]
): Promise<IntegrationType | null> {
  const options = connectors.map((c) => {
    let label = c.displayName;
    if (c.accountEmail) {
      label += ` (${c.accountEmail})`;
    } else if (c.inLocal && !c.inBackend) {
      label += " (not connected)";
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
    return null;
  }

  return selected;
}

export async function removeConnectorCommand(
  integrationType?: string,
  options: RemoveOptions = {}
): Promise<RunCommandResult> {
  const isHardDelete = options.hard === true;

  // Fetch both local and backend connectors
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

  const merged = mergeConnectorsForRemoval(localConnectors, backendConnectors);

  if (merged.length === 0) {
    return {
      outroMessage: "No connectors to remove",
    };
  }

  // If no type provided, prompt for selection
  let selectedType: IntegrationType;
  let selectedConnector: MergedConnector | undefined;

  if (!integrationType) {
    const prompted = await promptForConnectorToRemove(merged);
    if (!prompted) {
      return { outroMessage: "Cancelled" };
    }
    selectedType = prompted;
    selectedConnector = merged.find((c) => c.type === selectedType);
  } else {
    // Validate the provided integration type
    if (!isValidIntegration(integrationType)) {
      throw new Error(`Invalid connector type: ${integrationType}`);
    }

    selectedConnector = merged.find((c) => c.type === integrationType);
    if (!selectedConnector) {
      throw new Error(
        `No ${getIntegrationDisplayName(integrationType)} connector found`
      );
    }

    selectedType = integrationType;
  }

  const displayName = getIntegrationDisplayName(selectedType);
  const accountInfo = selectedConnector?.accountEmail
    ? ` (${selectedConnector.accountEmail})`
    : "";

  // Confirm removal with appropriate message
  const actionWord = isHardDelete ? "Permanently remove" : "Remove";
  const shouldRemove = await confirm({
    message: `${actionWord} ${displayName}${accountInfo}?`,
    initialValue: false,
  });

  if (isCancel(shouldRemove) || !shouldRemove) {
    return { outroMessage: "Cancelled" };
  }

  // Perform removal
  const taskMessage = isHardDelete
    ? `Removing ${displayName}...`
    : `Removing ${displayName}...`;

  await runTask(
    taskMessage,
    async () => {
      // Remove from backend if it exists there
      if (selectedConnector?.inBackend) {
        if (isHardDelete) {
          await removeConnector(selectedType);
        } else {
          await disconnectConnector(selectedType);
        }
      }

      // Remove from local config
      await removeLocalConnector(selectedType);
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

export const connectorsRemoveCommand = new Command("connectors:remove")
  .argument("[type]", "Integration type to remove (e.g., slack, notion)")
  .option("--hard", "Permanently remove the connector (cannot be undone)")
  .description("Remove an OAuth integration")
  .action(async (type: string | undefined, options: RemoveOptions) => {
    await runCommand(() => removeConnectorCommand(type, options), {
      requireAuth: true,
      requireAppConfig: true,
    });
  });
