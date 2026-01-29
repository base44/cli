import { Command } from "commander";
import { log, confirm, isCancel, cancel } from "@clack/prompts";
import {
  initiateOAuth,
  listConnectors,
  removeConnector,
  isValidIntegration,
  getIntegrationDisplayName,
} from "@/core/connectors/index.js";
import type { IntegrationType, Connector } from "@/core/connectors/index.js";
import { readProjectConfig } from "@/core/project/config.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import { theme } from "../../utils/theme.js";
import { waitForOAuthCompletion } from "./utils.js";

interface PushOptions {
  yes?: boolean;
}

/**
 * Get connectors defined in the local config.jsonc
 */
async function getLocalConnectors(): Promise<IntegrationType[]> {
  const projectData = await runTask(
    "Reading project config...",
    async () => readProjectConfig(),
    {
      successMessage: "Project config loaded",
      errorMessage: "Failed to read project config",
    }
  );

  const connectors = projectData.project.connectors || [];

  // Validate all connectors are supported
  const validConnectors: IntegrationType[] = [];
  const invalidConnectors: string[] = [];

  for (const connector of connectors) {
    if (isValidIntegration(connector)) {
      validConnectors.push(connector as IntegrationType);
    } else {
      invalidConnectors.push(connector);
    }
  }

  if (invalidConnectors.length > 0) {
    throw new Error(
      `Invalid connectors found in config.jsonc: ${invalidConnectors.join(", ")}`
    );
  }

  return validConnectors;
}

/**
 * Get active connectors from the backend
 */
async function getBackendConnectors(): Promise<Set<IntegrationType>> {
  const connectors = await runTask(
    "Fetching active connectors...",
    async () => listConnectors(),
    {
      successMessage: "Active connectors loaded",
      errorMessage: "Failed to fetch connectors",
    }
  );

  const activeConnectors = new Set<IntegrationType>();

  for (const connector of connectors) {
    if (isValidIntegration(connector.integrationType)) {
      activeConnectors.add(connector.integrationType);
    }
  }

  return activeConnectors;
}

/**
 * Activate a connector by initiating OAuth and polling for completion
 */
async function activateConnector(
  integrationType: IntegrationType
): Promise<{ success: boolean; accountEmail?: string; error?: string }> {
  const displayName = getIntegrationDisplayName(integrationType);

  // Initiate OAuth flow
  const initiateResponse = await runTask(
    `Initiating ${displayName} connection...`,
    async () => {
      return await initiateOAuth(integrationType);
    },
    {
      successMessage: `${displayName} OAuth initiated`,
      errorMessage: `Failed to initiate ${displayName} connection`,
    }
  );

  // Check if already authorized
  if (initiateResponse.alreadyAuthorized) {
    return { success: true };
  }

  // Check if connected by different user
  if (initiateResponse.error === "different_user" && initiateResponse.otherUserEmail) {
    return {
      success: false,
      error: `Already connected by ${initiateResponse.otherUserEmail}`,
    };
  }

  // Validate we have required fields
  if (!initiateResponse.redirectUrl || !initiateResponse.connectionId) {
    return {
      success: false,
      error: "Invalid response from server: missing redirect URL or connection ID",
    };
  }

  // Show authorization URL
  log.info(
    `Please authorize ${displayName} at:\n${theme.colors.links(initiateResponse.redirectUrl)}`
  );

  // Poll for completion
  const result = await runTask(
    "Waiting for authorization...",
    async () => {
      return await waitForOAuthCompletion(integrationType, initiateResponse.connectionId!);
    },
    {
      successMessage: "Authorization completed!",
      errorMessage: "Authorization failed",
    }
  );

  return result;
}

/**
 * Delete a connector from the backend (hard delete)
 */
async function deleteConnector(integrationType: IntegrationType): Promise<void> {
  const displayName = getIntegrationDisplayName(integrationType);

  await runTask(
    `Removing ${displayName}...`,
    async () => {
      await removeConnector(integrationType);
    },
    {
      successMessage: `${displayName} removed`,
      errorMessage: `Failed to remove ${displayName}`,
    }
  );
}

export async function push(options: PushOptions = {}): Promise<RunCommandResult> {
  // Step 1: Get local and backend connectors
  const localConnectors = await getLocalConnectors();
  const backendConnectors = await getBackendConnectors();

  // Step 2: Determine what needs to be done
  const toDelete: IntegrationType[] = [];
  const toActivate: IntegrationType[] = [];
  const alreadyActive: IntegrationType[] = [];

  // Find connectors to delete (in backend but not local)
  for (const connector of backendConnectors) {
    if (!localConnectors.includes(connector)) {
      toDelete.push(connector);
    }
  }

  // Find connectors to activate or skip
  for (const connector of localConnectors) {
    if (backendConnectors.has(connector)) {
      alreadyActive.push(connector);
    } else {
      toActivate.push(connector);
    }
  }

  // Step 3: Show summary and confirm if needed
  if (toDelete.length === 0 && toActivate.length === 0) {
    return {
      outroMessage: "All connectors are in sync. Nothing to do.",
    };
  }

  log.info("\nConnector sync summary:");

  if (toDelete.length > 0) {
    log.warn(`  ${theme.colors.error("Delete from backend:")} ${toDelete.map(getIntegrationDisplayName).join(", ")}`);
  }

  if (toActivate.length > 0) {
    log.info(`  ${theme.colors.success("Activate:")} ${toActivate.map(getIntegrationDisplayName).join(", ")}`);
  }

  if (alreadyActive.length > 0) {
    log.info(`  ${theme.colors.dim("Already active:")} ${alreadyActive.map(getIntegrationDisplayName).join(", ")}`);
  }

  // Confirm if not using --yes flag
  if (!options.yes && toDelete.length > 0) {
    const shouldContinue = await confirm({
      message: `Delete ${toDelete.length} connector(s) from backend?`,
    });

    if (isCancel(shouldContinue) || !shouldContinue) {
      cancel("Operation cancelled.");
      process.exit(0);
    }
  }

  // Step 4: Delete connectors no longer in config
  const deleteResults: string[] = [];
  for (const connector of toDelete) {
    try {
      await deleteConnector(connector);
      deleteResults.push(`${theme.colors.success("✓")} Deleted ${getIntegrationDisplayName(connector)}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      deleteResults.push(`${theme.colors.error("✗")} Failed to delete ${getIntegrationDisplayName(connector)}: ${errorMsg}`);
    }
  }

  // Step 5: Activate new connectors
  const activationResults: string[] = [];
  for (const connector of toActivate) {
    try {
      const result = await activateConnector(connector);

      if (result.success) {
        const accountInfo = result.accountEmail ? ` as ${theme.styles.bold(result.accountEmail)}` : "";
        activationResults.push(`${theme.colors.success("✓")} Activated ${getIntegrationDisplayName(connector)}${accountInfo}`);
      } else {
        activationResults.push(`${theme.colors.error("✗")} Failed to activate ${getIntegrationDisplayName(connector)}: ${result.error}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      activationResults.push(`${theme.colors.error("✗")} Failed to activate ${getIntegrationDisplayName(connector)}: ${errorMsg}`);
    }
  }

  // Step 6: Build summary message
  const summaryLines: string[] = [];

  if (deleteResults.length > 0) {
    summaryLines.push("\nDeleted connectors:");
    summaryLines.push(...deleteResults.map(r => `  ${r}`));
  }

  if (activationResults.length > 0) {
    summaryLines.push("\nActivated connectors:");
    summaryLines.push(...activationResults.map(r => `  ${r}`));
  }

  return {
    outroMessage: summaryLines.join("\n") || "Connector sync completed",
  };
}

export const connectorsPushCommand = new Command("push")
  .description("Sync connectors defined in config.jsonc with backend")
  .option("-y, --yes", "Skip confirmation prompts")
  .action(async (options: PushOptions) => {
    await runCommand(() => push(options), {
      requireAuth: true,
      requireAppConfig: true,
    });
  });
