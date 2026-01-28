import { Command } from "commander";
import { cancel, log, select, isCancel } from "@clack/prompts";
import {
  initiateOAuth,
  SUPPORTED_INTEGRATIONS,
  INTEGRATION_DISPLAY_NAMES,
  getIntegrationDisplayName,
} from "@/core/connectors/index.js";
import type { IntegrationType } from "@/core/connectors/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import { theme } from "../../utils/theme.js";
import { assertValidIntegrationType, waitForOAuthCompletion } from "./utils.js";

async function promptForIntegrationType(): Promise<IntegrationType> {
  const options = Object.entries(INTEGRATION_DISPLAY_NAMES).map(
    ([type, displayName]) => ({
      value: type,
      label: displayName,
    })
  );

  const selected = await select({
    message: "Select an integration to connect:",
    options,
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }

  return selected as IntegrationType;
}

async function pollForOAuthCompletion(
  integrationType: IntegrationType,
  connectionId: string
): Promise<{ success: boolean; accountEmail?: string; error?: string }> {
  return await runTask(
    "Waiting for authorization...",
    async () => {
      return await waitForOAuthCompletion(integrationType, connectionId);
    },
    {
      successMessage: "Authorization completed!",
      errorMessage: "Authorization failed",
    }
  );
}

export async function addConnector(
  integrationType?: string
): Promise<RunCommandResult> {
  // Get type from argument or prompt
  let selectedType: IntegrationType;
  if (integrationType) {
    assertValidIntegrationType(integrationType, SUPPORTED_INTEGRATIONS);
    selectedType = integrationType;
  } else {
    selectedType = await promptForIntegrationType();
  }

  const displayName = getIntegrationDisplayName(selectedType);

  // Initiate OAuth flow
  const initiateResponse = await runTask(
    `Initiating ${displayName} connection...`,
    async () => {
      return await initiateOAuth(selectedType);
    },
    {
      successMessage: `${displayName} OAuth initiated`,
      errorMessage: `Failed to initiate ${displayName} connection`,
    }
  );

  // Check if already authorized
  if (initiateResponse.alreadyAuthorized) {
    return {
      outroMessage: `Already connected to ${theme.styles.bold(displayName)}`,
    };
  }

  // Check if connected by different user
  if (initiateResponse.error === "different_user" && initiateResponse.otherUserEmail) {
    throw new Error(
      `This app is already connected to ${displayName} by ${initiateResponse.otherUserEmail}`
    );
  }

  // Validate we have required fields
  if (!initiateResponse.redirectUrl || !initiateResponse.connectionId) {
    throw new Error("Invalid response from server: missing redirect URL or connection ID");
  }

  // Show authorization URL
  log.info(
    `Please authorize ${displayName} at:\n${theme.colors.links(initiateResponse.redirectUrl)}`
  );

  // Poll for completion
  const result = await pollForOAuthCompletion(
    selectedType,
    initiateResponse.connectionId
  );

  if (!result.success) {
    throw new Error(result.error || "Authorization failed");
  }

  const accountInfo = result.accountEmail
    ? ` as ${theme.styles.bold(result.accountEmail)}`
    : "";

  return {
    outroMessage: `Successfully connected to ${theme.styles.bold(displayName)}${accountInfo}`,
  };
}

export const connectorsAddCommand = new Command("add")
  .argument("[type]", "Integration type (e.g., slack, notion, googlecalendar)")
  .description("Connect an OAuth integration")
  .action(async (type?: string) => {
    await runCommand(() => addConnector(type), {
      requireAuth: true,
      requireAppConfig: true,
    });
  });
