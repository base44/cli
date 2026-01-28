import { Command } from "commander";
import { cancel, log, select, isCancel } from "@clack/prompts";
import {
  initiateOAuth,
  waitForOAuthCompletion,
  SUPPORTED_INTEGRATIONS,
  isValidIntegration,
  getIntegrationDisplayName,
} from "@/core/connectors/index.js";
import type { IntegrationType } from "@/core/connectors/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import { theme } from "../../utils/theme.js";

function validateIntegrationType(type: string): IntegrationType {
  if (!isValidIntegration(type)) {
    const supportedList = SUPPORTED_INTEGRATIONS.join(", ");
    throw new Error(
      `Unsupported connector: ${type}\nSupported connectors: ${supportedList}`
    );
  }
  return type;
}

async function promptForIntegrationType(): Promise<IntegrationType> {
  const options = SUPPORTED_INTEGRATIONS.map((type) => ({
    value: type,
    label: getIntegrationDisplayName(type),
  }));

  const selected = await select({
    message: "Select an integration to connect:",
    options,
  });

  if (isCancel(selected)) {
    cancel("Operation cancelled.");
    process.exit(0);
  }

  return selected;
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
  const selectedType = integrationType
    ? validateIntegrationType(integrationType)
    : await promptForIntegrationType();

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
  if (initiateResponse.already_authorized) {
    return {
      outroMessage: `Already connected to ${theme.styles.bold(displayName)}`,
    };
  }

  // Check if connected by different user
  if (initiateResponse.error === "different_user" && initiateResponse.other_user_email) {
    throw new Error(
      `This app is already connected to ${displayName} by ${initiateResponse.other_user_email}`
    );
  }

  // Validate we have required fields
  if (!initiateResponse.redirect_url || !initiateResponse.connection_id) {
    throw new Error("Invalid response from server: missing redirect URL or connection ID");
  }

  // Show authorization URL
  log.info(
    `Please authorize ${displayName} at:\n${theme.colors.links(initiateResponse.redirect_url)}`
  );

  // Poll for completion
  const result = await pollForOAuthCompletion(
    selectedType,
    initiateResponse.connection_id
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
