import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { InvalidInputError } from "@/core/errors.js";
import type { AuditLogFilters, AuditLogsResponse } from "@/core/logs/index.js";
import { fetchAuditLogs } from "@/core/logs/index.js";

interface LogsOptions {
  status?: string;
  eventTypes?: string;
  userEmail?: string;
  startDate?: string;
  endDate?: string;
  limit?: string;
  order?: string;
  cursorTimestamp?: string;
  cursorUserEmail?: string;
  json?: boolean;
}

/**
 * Parse CLI options into AuditLogFilters.
 */
function parseOptions(options: LogsOptions): AuditLogFilters {
  const filters: AuditLogFilters = {};

  if (options.status) {
    if (options.status !== "success" && options.status !== "failure") {
      throw new InvalidInputError(
        `Invalid status: "${options.status}". Must be "success" or "failure".`
      );
    }
    filters.status = options.status;
  }

  if (options.eventTypes) {
    try {
      const parsed = JSON.parse(options.eventTypes);
      if (!Array.isArray(parsed)) {
        throw new Error("Not an array");
      }
      filters.eventTypes = parsed;
    } catch {
      throw new InvalidInputError(
        `Invalid event-types: "${options.eventTypes}". Must be a JSON array (e.g., '["api.function.call"]').`
      );
    }
  }

  if (options.userEmail) {
    filters.userEmail = options.userEmail;
  }

  if (options.startDate) {
    filters.startDate = options.startDate;
  }

  if (options.endDate) {
    filters.endDate = options.endDate;
  }

  if (options.limit) {
    const limit = Number.parseInt(options.limit, 10);
    if (Number.isNaN(limit) || limit < 1 || limit > 1000) {
      throw new InvalidInputError(
        `Invalid limit: "${options.limit}". Must be a number between 1 and 1000.`
      );
    }
    filters.limit = limit;
  }

  if (options.order) {
    const order = options.order.toUpperCase();
    if (order !== "ASC" && order !== "DESC") {
      throw new InvalidInputError(
        `Invalid order: "${options.order}". Must be "ASC" or "DESC".`
      );
    }
    filters.order = order as "ASC" | "DESC";
  }

  if (options.cursorTimestamp) {
    filters.cursorTimestamp = options.cursorTimestamp;
  }

  if (options.cursorUserEmail) {
    filters.cursorUserEmail = options.cursorUserEmail;
  }

  return filters;
}

/**
 * Format a single log event for human-readable output.
 */
function formatEvent(event: AuditLogsResponse["events"][0]): string {
  // Shorten timestamp to readable format (remove microseconds)
  const timestamp = event.timestamp.substring(0, 19).replace("T", " ");
  const eventType = event.event_type;
  const user = event.user_email || "-";
  const status =
    event.status === "success"
      ? theme.colors.base44Orange(event.status)
      : theme.colors.white(event.status);

  return `${theme.styles.dim(timestamp)}  ${eventType.padEnd(24)}  ${user.padEnd(28)}  ${status}`;
}

/**
 * Display logs in human-readable format.
 */
function displayLogs(response: AuditLogsResponse): void {
  const { events, pagination } = response;

  if (events.length === 0) {
    log.info("No events found matching the filters.");
    return;
  }

  // Header
  log.info(
    theme.styles.dim(`Showing ${events.length} of ${pagination.total} events\n`)
  );

  const header = `${"TIME".padEnd(19)}  ${"EVENT TYPE".padEnd(24)}  ${"USER".padEnd(28)}  STATUS`;
  log.message(theme.styles.header(header));

  // Events
  for (const event of events) {
    log.message(formatEvent(event));
  }

  // Pagination hint
  if (pagination.has_more && pagination.next_cursor) {
    log.info(
      theme.styles.dim(
        `\nMore results available. Use --cursor-timestamp="${pagination.next_cursor.timestamp}" --cursor-user-email="${pagination.next_cursor.user_email}" for next page.`
      )
    );
  }
}

async function logsAction(options: LogsOptions): Promise<RunCommandResult> {
  const filters = parseOptions(options);

  const response = await runTask(
    "Fetching audit logs...",
    async () => {
      return await fetchAuditLogs(filters);
    },
    {
      successMessage: "Logs fetched successfully",
      errorMessage: "Failed to fetch audit logs",
    }
  );

  if (options.json) {
    // Output raw JSON for scripting - use process.stdout for proper capture
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  } else {
    displayLogs(response);
  }

  return {};
}

export function getLogsCommand(context: CLIContext): Command {
  return new Command("logs")
    .description("Fetch audit logs for this app")
    .option("--status <status>", "Filter by outcome: success|failure")
    .option(
      "--event-types <types>",
      "Filter by event types (JSON array, e.g., '[\"api.function.call\"]')"
    )
    .option("--user-email <email>", "Filter by user email")
    .option("--start-date <date>", "Filter events from this date (ISO format)")
    .option("--end-date <date>", "Filter events until this date (ISO format)")
    .option("-n, --limit <n>", "Results per page (1-1000, default: 50)")
    .option("--order <order>", "Sort order: ASC|DESC (default: DESC)")
    .option("--cursor-timestamp <ts>", "Pagination cursor timestamp")
    .option("--cursor-user-email <email>", "Pagination cursor user email")
    .option("--json", "Output raw JSON")
    .action(async (options: LogsOptions) => {
      await runCommand(
        () => logsAction(options),
        { requireAuth: true },
        context
      );
    });
}
