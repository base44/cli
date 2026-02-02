import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { theme } from "@/cli/utils/theme.js";
import { readProjectConfig } from "@/core/index.js";
import type {
  ConnectorPushResult,
  ConnectorsPushSummary,
} from "@/core/resources/connector/index.js";
import { pushConnectors } from "@/core/resources/connector/index.js";

/**
 * Format a push result status with appropriate styling
 */
function formatStatus(result: ConnectorPushResult): string {
  switch (result.status) {
    case "ACTIVE":
      return "✓ ACTIVE";
    case "SCOPE_MISMATCH":
      return theme.colors.base44Orange("⚠ SCOPE_MISMATCH");
    case "PENDING_AUTH":
      return theme.colors.base44Orange("✗ PENDING_AUTH");
    case "AUTH_FAILED":
      return theme.colors.base44Orange("✗ AUTH_FAILED");
    case "DELETED":
      return theme.styles.dim("🗑 DELETED");
    case "DIFFERENT_USER":
      return theme.colors.base44Orange("✗ DIFFERENT_USER");
  }
}

/**
 * Print a summary table of push results
 */
function printSummaryTable(summary: ConnectorsPushSummary): void {
  if (summary.results.length === 0) {
    return;
  }

  log.message("");
  log.message(
    theme.styles.bold("┌─────────────────────────────────────────────────────────────────┐")
  );
  log.message(
    theme.styles.bold("│                  Connectors Push Summary                        │")
  );
  log.message(
    theme.styles.bold("├──────────────────┬─────────────────┬────────────────────────────┤")
  );
  log.message(
    theme.styles.bold("│ Connector        │ Status          │ Details                    │")
  );
  log.message(
    theme.styles.bold("├──────────────────┼─────────────────┼────────────────────────────┤")
  );

  for (const result of summary.results) {
    const connector = result.type.padEnd(16);
    const statusText = formatStatus(result);
    const status = statusText.padEnd(15);
    const details = (result.details || result.error || "").substring(0, 28).padEnd(28);
    log.message(`│ ${connector} │ ${status} │ ${details}│`);
  }

  log.message(
    theme.styles.bold("└──────────────────┴─────────────────┴────────────────────────────┘")
  );
  log.message("");
}

/**
 * Print warnings for connectors that need attention
 */
function printWarnings(summary: ConnectorsPushSummary): void {
  const needsAttention = summary.results.filter(
    (r) =>
      r.status === "SCOPE_MISMATCH" ||
      r.status === "PENDING_AUTH" ||
      r.status === "AUTH_FAILED" ||
      r.status === "DIFFERENT_USER"
  );

  if (needsAttention.length === 0) {
    return;
  }

  log.warn("Some connectors need attention:");
  for (const result of needsAttention) {
    if (result.status === "SCOPE_MISMATCH") {
      log.message(
        `  • ${result.type}: Approved scopes differ from requested. Adjust connectors/${result.type}.jsonc or run \`base44 connectors push\` again to re-auth.`
      );
    } else if (result.status === "PENDING_AUTH") {
      log.message(
        `  • ${result.type}: Authentication not completed. Run \`base44 connectors push\` to retry.`
      );
    } else if (result.status === "AUTH_FAILED") {
      log.message(
        `  • ${result.type}: OAuth flow failed${result.error ? `: ${result.error}` : ""}.`
      );
    } else if (result.status === "DIFFERENT_USER") {
      log.message(
        `  • ${result.type}: Another user already authorized this connector.`
      );
    }
  }
}

async function pushConnectorsAction(): Promise<RunCommandResult> {
  const { connectors } = await readProjectConfig();

  if (connectors.length === 0) {
    return { outroMessage: "No connectors found in project" };
  }

  const connectorTypes = connectors.map((c) => c.type).join(", ");
  log.info(`Found ${connectors.length} connectors to push: ${connectorTypes}`);

  // Push connectors (this handles OAuth flows interactively)
  const summary = await pushConnectors(connectors);

  // Print summary table
  printSummaryTable(summary);

  // Print warnings if needed
  printWarnings(summary);

  if (summary.hasErrors) {
    return {
      outroMessage: theme.colors.base44Orange(
        "Connectors push completed with errors"
      ),
    };
  }

  if (summary.hasWarnings) {
    return {
      outroMessage: theme.colors.base44Orange(
        "Connectors push completed with warnings"
      ),
    };
  }

  return { outroMessage: "All connectors pushed successfully" };
}

export function getConnectorsPushCommand(context: CLIContext): Command {
  return new Command("connectors")
    .description("Manage OAuth connectors")
    .addCommand(
      new Command("push")
        .description("Push local connectors to Base44")
        .action(async () => {
          await runCommand(pushConnectorsAction, { requireAuth: true }, context);
        })
    );
}
