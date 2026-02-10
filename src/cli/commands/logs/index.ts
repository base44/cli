import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/index.js";
import type {
  FunctionLogFilters,
  FunctionLogsResponse,
  LogLevel,
} from "@/core/resources/function/index.js";
import {
  FunctionNotFoundError,
  fetchFunctionLogs,
} from "@/core/resources/function/index.js";

// ─── TYPES ──────────────────────────────────────────────────

interface LogsOptions {
  function?: string;
  since?: string;
  until?: string;
  level?: string;
  limit?: string;
  order?: string;
  json?: boolean;
}

/**
 * Unified log entry for display.
 */
interface LogEntry {
  time: string;
  level: string;
  message: string;
  source: string; // function name
}

// ─── CONSTANTS ──────────────────────────────────────────────

const VALID_LEVELS = ["log", "info", "warn", "error", "debug"];

// ─── OPTION PARSING ─────────────────────────────────────────

/**
 * Parse CLI options into FunctionLogFilters.
 */
function parseFunctionFilters(options: LogsOptions): FunctionLogFilters {
  const filters: FunctionLogFilters = {};

  if (options.since) {
    filters.since = options.since;
  }

  if (options.until) {
    filters.until = options.until;
  }

  if (options.level) {
    filters.level = options.level as LogLevel;
  }

  if (options.limit) {
    filters.limit = Number.parseInt(options.limit, 10);
  }

  if (options.order) {
    filters.order = options.order.toLowerCase() as "asc" | "desc";
  }

  return filters;
}

/**
 * Parse --function option into array of function names.
 */
function parseFunctionNames(option: string | undefined): string[] {
  if (!option) return [];
  return option
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Ensure datetime has a timezone (append Z if missing) for APIs that require it.
 */
function normalizeDatetime(value: string): string {
  if (/Z|[+-]\d{2}:\d{2}$/.test(value)) return value;
  return `${value}Z`;
}

/**
 * Validate CLI options upfront before any API calls.
 */
function validateOptions(options: LogsOptions): void {
  if (options.level && !VALID_LEVELS.includes(options.level)) {
    throw new InvalidInputError(
      `Invalid level: "${options.level}". Must be one of: ${VALID_LEVELS.join(", ")}.`
    );
  }
  if (options.limit) {
    const limit = Number.parseInt(options.limit, 10);
    if (Number.isNaN(limit) || limit < 1 || limit > 1000) {
      throw new InvalidInputError(
        `Invalid limit: "${options.limit}". Must be a number between 1 and 1000.`
      );
    }
  }
  if (options.order) {
    const order = options.order.toUpperCase();
    if (order !== "ASC" && order !== "DESC") {
      throw new InvalidInputError(
        `Invalid order: "${options.order}". Must be "ASC" or "DESC".`
      );
    }
  }
}

// ─── DISPLAY ────────────────────────────────────────────────

/**
 * Format a single log entry as a plain log-file line.
 */
function formatEntry(entry: LogEntry): string {
  const time = entry.time.substring(0, 19).replace("T", " ");
  const level = entry.level.toUpperCase().padEnd(5);
  const message = entry.message.trim();
  return `${time} ${level} ${message}\n`;
}

/**
 * Display function logs (log-file style, plain stdout).
 */
function displayLogs(entries: LogEntry[]): void {
  if (entries.length === 0) {
    process.stdout.write("No logs found matching the filters.\n");
    return;
  }

  process.stdout.write(`Showing ${entries.length} function log entries\n\n`);

  for (const entry of entries) {
    process.stdout.write(formatEntry(entry));
  }
}

// ─── ACTIONS ────────────────────────────────────────────────

/**
 * Normalize a function log entry to display format.
 */
function normalizeLogEntry(
  entry: { time: string; level: string; message: string },
  functionName: string
): LogEntry {
  return {
    time: entry.time,
    level: entry.level,
    message: `[${functionName}] ${entry.message}`,
    source: functionName,
  };
}

/**
 * Fetch logs for specified functions.
 * If a function is not found, re-throws with a hint listing available functions.
 */
async function fetchLogsForFunctions(
  functionNames: string[],
  options: LogsOptions,
  availableFunctionNames: string[]
): Promise<LogEntry[]> {
  const filters = parseFunctionFilters(options);
  const allEntries: LogEntry[] = [];

  for (const functionName of functionNames) {
    let logs: FunctionLogsResponse;
    try {
      logs = await fetchFunctionLogs(functionName, filters);
    } catch (error) {
      if (
        error instanceof FunctionNotFoundError &&
        availableFunctionNames.length > 0
      ) {
        const available = availableFunctionNames.join(", ");
        throw new InvalidInputError(
          `Function "${functionName}" was not found in this app`,
          {
            hints: [
              {
                message: `Available functions in this project: ${available}`,
              },
              {
                message:
                  "Make sure the function has been deployed before fetching logs",
                command: "base44 functions deploy",
              },
            ],
          }
        );
      }
      throw error;
    }

    const entries = logs.map((entry) => normalizeLogEntry(entry, functionName));
    allEntries.push(...entries);
  }

  // When fetching multiple functions, merge-sort the combined results
  // (each function's logs are already sorted by the backend)
  if (functionNames.length > 1) {
    const order = options.order?.toUpperCase() === "ASC" ? 1 : -1;
    allEntries.sort((a, b) => order * a.time.localeCompare(b.time));
  }

  return allEntries;
}

/**
 * Get all function names from project config.
 */
async function getAllFunctionNames(): Promise<string[]> {
  const { functions } = await readProjectConfig();
  return functions.map((fn) => fn.name);
}

/**
 * Main logs action.
 */
async function logsAction(options: LogsOptions): Promise<RunCommandResult> {
  if (options.since) options.since = normalizeDatetime(options.since);
  if (options.until) options.until = normalizeDatetime(options.until);
  validateOptions(options);

  const specifiedFunctions = parseFunctionNames(options.function);

  // Always read project functions so we can list them in error messages
  const allProjectFunctions = await getAllFunctionNames();

  // Determine which functions to fetch logs for
  const functionNames =
    specifiedFunctions.length > 0 ? specifiedFunctions : allProjectFunctions;

  if (functionNames.length === 0) {
    process.stdout.write("No functions found in this project.\n");
    return {};
  }

  let entries = await fetchLogsForFunctions(
    functionNames,
    options,
    allProjectFunctions
  );

  // Apply limit after merging logs from all functions
  const limit = options.limit ? Number.parseInt(options.limit, 10) : undefined;
  if (limit !== undefined && entries.length > limit) {
    entries = entries.slice(0, limit);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
  } else {
    displayLogs(entries);
  }

  return {};
}

// ─── COMMAND ────────────────────────────────────────────────

export function getLogsCommand(context: CLIContext): Command {
  return new Command("logs")
    .description("Fetch function logs for this app")
    .option(
      "--function <names>",
      "Filter by function name(s), comma-separated. If omitted, fetches logs for all project functions"
    )
    .option("--since <datetime>", "Show logs from this time (ISO format)")
    .option("--until <datetime>", "Show logs until this time (ISO format)")
    .option(
      "--level <level>",
      "Filter by log level: log, info, warn, error, debug"
    )
    .option("-n, --limit <n>", "Results per page (1-1000, default: 50)")
    .option("--order <order>", "Sort order: ASC|DESC (default: DESC)")
    .option("--json", "Output raw JSON")
    .action(async (options: LogsOptions) => {
      await runCommand(
        () => logsAction(options),
        { requireAuth: true, skipIntro: true, skipOutro: true },
        context
      );
    });
}
