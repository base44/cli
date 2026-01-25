import { Command } from "commander";
import { cancel, log, select, isCancel } from "@clack/prompts";
import pWaitFor from "p-wait-for";
import {
  initiateOAuth,
  checkOAuthStatus,
  addLocalConnector,
  SUPPORTED_INTEGRATIONS,
  OAUTH_POLL_INTERVAL_MS,
  OAUTH_POLL_TIMEOUT_MS,
  isValidIntegration,
  getIntegrationDisplayName,
} from "@core/connectors/index.js";
import type { IntegrationType } from "@core/connectors/index.js";
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

async function waitForOAuthCompletion(
  integrationType: IntegrationType,
  connectionId: string
): Promise<{ success: boolean; accountEmail?: string; error?: string }> {
  let accountEmail: string | undefined;
  let error: string | undefined;

  try {
    await runTask(
      "Waiting for authorization...",
      async (updateMessage) => {
        await pWaitFor(
          async () => {
            const status = await checkOAuthStatus(integrationType, connectionId);

            if (status.status === "ACTIVE") {
              accountEmail = status.accountEmail ?? undefined;
              return true;
            }

            if (status.status === "FAILED") {
              error = status.error || "Authorization failed";
              throw new Error(error);
            }

            // PENDING - continue polling
            updateMessage("Waiting for authorization in browser...");
            return false;
          },
          {
            interval: OAUTH_POLL_INTERVAL_MS,
            timeout: OAUTH_POLL_TIMEOUT_MS,
          }
        );
      },
      {
        successMessage: "Authorization completed!",
        errorMessage: "Authorization failed",
      }
    );

    return { success: true, accountEmail };
  } catch (err) {
    if (err instanceof Error && err.message.includes("timed out")) {
      return { success: false, error: "Authorization timed out. Please try again." };
    }
    return { success: false, error: error || (err instanceof Error ? err.message : "Unknown error") };
  }
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
    // Still add to local config file
    await addLocalConnector(selectedType);
    return {
      outroMessage: `Already connected to ${theme.styles.bold(displayName)} (added to config)`,
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
  const result = await waitForOAuthCompletion(
    selectedType,
    initiateResponse.connection_id
  );

  if (!result.success) {
    throw new Error(result.error || "Authorization failed");
  }

  // Add to local config file after successful OAuth
  await addLocalConnector(selectedType);

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
