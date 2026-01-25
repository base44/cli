import { Command } from "commander";
import { cancel, confirm, select, isCancel } from "@clack/prompts";
import {
  fetchConnectorState,
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
  yes?: boolean;
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
    const accountEmail = (connector.accountInfo?.email || connector.accountInfo?.name) ?? undefined;
    if (existing) {
      existing.inBackend = true;
      existing.accountEmail = accountEmail;
    } else {
      merged.set(connector.integrationType, {
        type: connector.integrationType,
        displayName: getIntegrationDisplayName(connector.integrationType),
        inLocal: false,
        inBackend: true,
        accountEmail,
      });
    }
  }

  return Array.from(merged.values());
}

function validateConnectorType(
  type: string,
  merged: MergedConnector[]
): { type: IntegrationType; connector: MergedConnector } {
  if (!isValidIntegration(type)) {
    throw new Error(`Invalid connector type: ${type}`);
  }

  const connector = merged.find((c) => c.type === type);
  if (!connector) {
    throw new Error(`No ${getIntegrationDisplayName(type)} connector found`);
  }

  return { type, connector };
}

async function promptForConnectorToRemove(
  connectors: MergedConnector[]
): Promise<{ type: IntegrationType; connector: MergedConnector }> {
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
    cancel("Operation cancelled.");
    process.exit(0);
  }

  const connector = connectors.find((c) => c.type === selected)!;
  return { type: selected, connector };
}

export async function removeConnectorCommand(
  integrationType?: string,
  options: RemoveOptions = {}
): Promise<RunCommandResult> {
  const isHardDelete = options.hard === true;

  // Fetch both local and backend connectors
  const { local: localConnectors, backend: backendConnectors } = await runTask(
    "Fetching connectors...",
    fetchConnectorState,
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

  // Get type from argument or prompt
  const { type: selectedType, connector: selectedConnector } = integrationType
    ? validateConnectorType(integrationType, merged)
    : await promptForConnectorToRemove(merged);

  const displayName = getIntegrationDisplayName(selectedType);
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
      // Remove from backend if it exists there
      if (selectedConnector.inBackend) {
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
