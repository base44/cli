import { Command } from "commander";
import { log, confirm, isCancel } from "@clack/prompts";
import pWaitFor from "p-wait-for";
import {
  listConnectors,
  readLocalConnectors,
  initiateOAuth,
  checkOAuthStatus,
  getIntegrationDisplayName,
} from "@core/connectors/index.js";
import type { IntegrationType, Connector, LocalConnector } from "@core/connectors/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import { theme } from "../../utils/theme.js";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface PendingConnector {
  type: IntegrationType;
  displayName: string;
  scopes?: string[];
}

function findPendingConnectors(
  local: LocalConnector[],
  backend: Connector[]
): PendingConnector[] {
  const connectedTypes = new Set(
    backend
      .filter((c) => c.status.toLowerCase() === "active")
      .map((c) => c.integrationType)
  );

  return local
    .filter((c) => !connectedTypes.has(c.type))
    .map((c) => ({
      type: c.type,
      displayName: getIntegrationDisplayName(c.type),
      scopes: c.scopes,
    }));
}

async function connectSingleConnector(
  connector: PendingConnector
): Promise<{ success: boolean; accountEmail?: string; error?: string }> {
  const { type, displayName, scopes } = connector;

  // Initiate OAuth
  const initiateResponse = await initiateOAuth(type, scopes || null);

  // Check if already authorized
  if (initiateResponse.already_authorized) {
    return { success: true };
  }

  // Check if connected by different user
  if (initiateResponse.error === "different_user") {
    return {
      success: false,
      error: `Already connected by ${initiateResponse.other_user_email}`,
    };
  }

  // Validate we have required fields
  if (!initiateResponse.redirect_url || !initiateResponse.connection_id) {
    return { success: false, error: "Invalid response from server" };
  }

  // Show authorization URL
  log.info(
    `Please authorize ${displayName} at:\n${theme.colors.links(initiateResponse.redirect_url)}`
  );

  // Poll for completion
  let accountEmail: string | undefined;

  try {
    await pWaitFor(
      async () => {
        const status = await checkOAuthStatus(type, initiateResponse.connection_id!);

        if (status.status === "ACTIVE") {
          accountEmail = status.accountEmail ?? undefined;
          return true;
        }

        if (status.status === "FAILED") {
          throw new Error(status.error || "Authorization failed");
        }

        return false;
      },
      {
        interval: POLL_INTERVAL_MS,
        timeout: POLL_TIMEOUT_MS,
      }
    );

    return { success: true, accountEmail };
  } catch (err) {
    if (err instanceof Error && err.message.includes("timed out")) {
      return { success: false, error: "Authorization timed out" };
    }
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function pushConnectorsCommand(): Promise<RunCommandResult> {
  // Fetch both local and backend connectors
  const [localConnectors, backendConnectors] = await runTask(
    "Checking connector status...",
    async () => {
      const [local, backend] = await Promise.all([
        readLocalConnectors(),
        listConnectors().catch(() => [] as Connector[]),
      ]);
      return [local, backend] as const;
    },
    {
      successMessage: "Status checked",
      errorMessage: "Failed to check status",
    }
  );

  if (localConnectors.length === 0) {
    log.info("No connectors defined in config");
    log.info(`Run ${theme.styles.bold("base44 connectors add")} to add a connector.`);
    return { outroMessage: "" };
  }

  const pending = findPendingConnectors(localConnectors, backendConnectors);

  if (pending.length === 0) {
    return { outroMessage: "All connectors are already connected" };
  }

  // Show what needs to be connected
  console.log();
  log.info(`${pending.length} connector${pending.length === 1 ? "" : "s"} need${pending.length === 1 ? "s" : ""} to be connected:`);
  for (const c of pending) {
    console.log(`  ${theme.colors.warning("○")} ${c.displayName}`);
  }
  console.log();

  // Confirm
  const shouldProceed = await confirm({
    message: `Connect ${pending.length} integration${pending.length === 1 ? "" : "s"}?`,
    initialValue: true,
  });

  if (isCancel(shouldProceed) || !shouldProceed) {
    return { outroMessage: "Cancelled" };
  }

  // Connect each one
  let connected = 0;
  let failed = 0;

  for (const connector of pending) {
    console.log();
    log.info(`Connecting ${theme.styles.bold(connector.displayName)}...`);

    const result = await connectSingleConnector(connector);

    if (result.success) {
      const accountInfo = result.accountEmail ? ` as ${result.accountEmail}` : "";
      log.success(`${connector.displayName} connected${accountInfo}`);
      connected++;
    } else {
      log.error(`${connector.displayName} failed: ${result.error}`);
      failed++;
    }
  }

  console.log();

  if (failed === 0) {
    return { outroMessage: `Successfully connected ${connected} integration${connected === 1 ? "" : "s"}` };
  }

  return { outroMessage: `Connected ${connected}, failed ${failed}` };
}

export const connectorsPushCommand = new Command("push")
  .description("Connect all pending integrations from config")
  .action(async () => {
    await runCommand(pushConnectorsCommand, {
      requireAuth: true,
      requireAppConfig: true,
    });
  });
