import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { InvalidInputError } from "@/core/errors.js";
import type {
  FunctionLogEntry,
  FunctionLogFilters,
  FunctionLogsResponse,
  LogLevel,
} from "@/core/resources/function/index.js";
import { fetchFunctionLogs } from "@/core/resources/function/index.js";

interface LogsOptions {
  since?: string;
  until?: string;
  level?: string;
  json?: boolean;
}

const VALID_LEVELS = ["log", "info", "warn", "error", "debug"];

/**
 * Parse CLI options into FunctionLogFilters.
 */
function parseOptions(options: LogsOptions): FunctionLogFilters {
  const filters: FunctionLogFilters = {};

  if (options.since) {
    filters.since = options.since;
  }

  if (options.until) {
    filters.until = options.until;
  }

  if (options.level) {
    if (!VALID_LEVELS.includes(options.level)) {
      throw new InvalidInputError(
        `Invalid level: "${options.level}". Must be one of: ${VALID_LEVELS.join(", ")}.`
      );
    }
    filters.level = options.level as LogLevel;
  }

  return filters;
}

/**
 * Get color/style for a log level.
 */
function formatLevel(level: LogLevel): string {
  switch (level) {
    case "error":
      return theme.colors.base44Orange(level.padEnd(5));
    case "warn":
      return theme.colors.shinyOrange(level.padEnd(5));
    case "info":
      return theme.colors.links(level.padEnd(5));
    case "debug":
      return theme.styles.dim(level.padEnd(5));
    default:
      return level.padEnd(5);
  }
}

/**
 * Format a single log entry for human-readable output.
 */
function formatLogEntry(entry: FunctionLogEntry): string {
  // Shorten timestamp to readable format
  const time = entry.time.substring(0, 19).replace("T", " ");
  const level = formatLevel(entry.level);
  // Truncate long messages for display (full message shown in JSON mode)
  const message =
    entry.message.length > 100
      ? `${entry.message.substring(0, 100)}...`
      : entry.message;

  return `${theme.styles.dim(time)}  ${level}  ${message}`;
}

/**
 * Display logs in human-readable format.
 */
function displayLogs(
  logs: FunctionLogsResponse,
  functionName: string,
  levelFilter?: LogLevel
): void {
  // Filter by level if specified (API doesn't support level filtering)
  const filteredLogs = levelFilter
    ? logs.filter((entry) => entry.level === levelFilter)
    : logs;

  if (filteredLogs.length === 0) {
    log.info(`No logs found for function "${functionName}".`);
    return;
  }

  // Header
  log.info(
    theme.styles.dim(
      `Showing ${filteredLogs.length} log entries for "${functionName}"\n`
    )
  );

  const header = `${"TIME".padEnd(19)}  ${"LEVEL".padEnd(5)}  MESSAGE`;
  log.message(theme.styles.header(header));

  // Log entries
  for (const entry of filteredLogs) {
    log.message(formatLogEntry(entry));
  }
}

async function logsAction(
  functionName: string,
  options: LogsOptions
): Promise<RunCommandResult> {
  const filters = parseOptions(options);

  const logs = await runTask(
    `Fetching logs for "${functionName}"...`,
    async () => {
      return await fetchFunctionLogs(functionName, filters);
    },
    {
      successMessage: "Logs fetched successfully",
      errorMessage: "Failed to fetch function logs",
    }
  );

  if (options.json) {
    // Filter by level for JSON output too
    const output = filters.level
      ? logs.filter((entry) => entry.level === filters.level)
      : logs;
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    displayLogs(logs, functionName, filters.level);
  }

  return {};
}

export function getFunctionsLogsCommand(context: CLIContext): Command {
  return new Command("logs")
    .description("Fetch runtime logs for a function")
    .argument("<function-name>", "Name of the function")
    .option("--since <datetime>", "Show logs from this time (ISO format)")
    .option("--until <datetime>", "Show logs until this time (ISO format)")
    .option(
      "--level <level>",
      "Filter by log level: log, info, warn, error, debug"
    )
    .option("--json", "Output raw JSON")
    .action(async (functionName: string, options: LogsOptions) => {
      await runCommand(
        () => logsAction(functionName, options),
        { requireAuth: true },
        context
      );
    });
}
