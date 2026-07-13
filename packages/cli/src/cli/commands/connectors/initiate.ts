import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import type {
  IntegrationType,
  OAuthSyncResult,
} from "@/core/resources/connector/index.js";
import {
  IntegrationTypeSchema,
  setConnector,
} from "@/core/resources/connector/index.js";
import { promptOAuthFlows } from "./oauth-prompt.js";

interface InitiateOptions {
  integrationType?: string;
  scopes?: string[];
}

function parseIntegrationType(value: string | undefined): IntegrationType {
  const result = IntegrationTypeSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidInputError(
      "A valid --integration-type is required (e.g. googlecalendar, gmail, slack).",
    );
  }
  return result.data;
}

/** Accept space-separated tokens (variadic) and split any comma-joined ones. */
function parseScopes(scopes: string[] | undefined): string[] {
  return (scopes ?? [])
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

async function initiateAction(
  ctx: CLIContext,
  options: InitiateOptions,
): Promise<RunCommandResult> {
  const { log, runTask, isNonInteractive, jsonMode } = ctx;
  const integrationType = parseIntegrationType(options.integrationType);
  const scopes = parseScopes(options.scopes);

  const response = await runTask(
    `Initiating ${integrationType} connector`,
    () => setConnector(integrationType, scopes),
    {
      successMessage: `Connector ${integrationType} initialized`,
      errorMessage: `Failed to initialize ${integrationType}`,
    },
  );

  if (response.error) {
    const detail =
      response.error === "different_user" && response.otherUserEmail
        ? ` (already authorized by ${response.otherUserEmail})`
        : response.errorMessage
          ? ` (${response.errorMessage})`
          : "";
    throw new InvalidInputError(
      `Could not initiate ${integrationType}: ${response.error}${detail}`,
    );
  }

  if (jsonMode) {
    // Emit the raw result; the caller (agent) opens redirectUrl itself. No
    // browser/poll in json mode (it's forced non-interactive).
    return {
      outroMessage: response.alreadyAuthorized
        ? `${integrationType} already authorized`
        : `${integrationType} initialized`,
      stdout: `${JSON.stringify(
        {
          integrationType,
          alreadyAuthorized: response.alreadyAuthorized,
          redirectUrl: response.redirectUrl,
          connectionId: response.connectionId,
        },
        null,
        2,
      )}\n`,
    };
  }

  if (response.alreadyAuthorized || !response.redirectUrl) {
    return {
      outroMessage: `${integrationType} is already authorized. Run 'base44 connectors pull' to fetch its config.`,
    };
  }

  // Always surface the URL so agents / non-interactive callers can use it.
  log.info(
    `Authorize ${integrationType} here: ${theme.colors.links(response.redirectUrl)}`,
  );

  const pending: OAuthSyncResult = {
    type: integrationType,
    action: "needs_oauth",
    redirectUrl: response.redirectUrl,
    connectionId: response.connectionId ?? undefined,
  };

  // Interactive: open the browser and poll until authorized. Non-interactive:
  // promptOAuthFlows just prints the link and returns (the URL is above too).
  const outcomes = await promptOAuthFlows([pending], log, {
    skipPrompt: isNonInteractive,
  });

  if (outcomes.get(integrationType) === "ACTIVE") {
    return {
      outroMessage: `${integrationType} authorized. Run 'base44 connectors pull' to fetch its config.`,
    };
  }

  return {
    outroMessage: `${integrationType} initialized. Open the link above to finish authorizing, then run 'base44 connectors pull'.`,
  };
}

export function getConnectorsInitiateCommand(): Command {
  return new Base44Command("initiate")
    .description(
      "Initialize a connector on an app and start its OAuth flow (works with --app-id, no local project required)",
    )
    .requiredOption(
      "--integration-type <type>",
      "Integration type to initiate (e.g. googlecalendar, gmail, slack)",
    )
    .option(
      "--scopes <scopes...>",
      "OAuth scopes to request (space- or comma-separated)",
    )
    .addHelpText(
      "after",
      `
Examples:
  $ base44 connectors initiate --app-id app_123 --integration-type googlecalendar --scopes https://www.googleapis.com/auth/calendar
  $ base44 connectors initiate --integration-type gmail --scopes scope.a,scope.b`,
    )
    .action(initiateAction);
}
