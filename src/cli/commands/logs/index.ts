import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/index.js";
import type {
  FunctionLogFilters,
  LogLevel,
} from "@/core/resources/function/index.js";
import { fetchFunctionLogs } from "@/core/resources/function/index.js";

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
 * Get color/style for a log level.
 */
function formatLevel(level: string): string {
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
 * Wrap a single line at specified width, returning array of lines.
 */
function wrapLine(text: string, width: number): string[] {
  if (text.length <= width) return [text];

  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > width) {
    // Find last space within width, or break at width if no space
    let breakPoint = remaining.lastIndexOf(" ", width);
    if (breakPoint <= 0) breakPoint = width;

    lines.push(remaining.substring(0, breakPoint));
    remaining = remaining.substring(breakPoint).trimStart();
  }

  if (remaining.length > 0) {
    lines.push(remaining);
  }

  return lines;
}

// Column widths: TIME(19) + 2 spaces + LEVEL(5) + 2 spaces = 28 chars before message
const MESSAGE_INDENT = " ".repeat(28);
const MESSAGE_WIDTH = 80;

/**
 * Format a log entry for display.
 * Preserves original newlines in the message and wraps long lines.
 */
function formatEntry(entry: LogEntry): string {
  const time = entry.time.substring(0, 19).replace("T", " ");
  const level = formatLevel(entry.level);

  // Split by original newlines first, then wrap each line
  const originalLines = entry.message.split("\n");
  const allLines: string[] = [];

  for (const line of originalLines) {
    const wrappedLines = wrapLine(line, MESSAGE_WIDTH);
    allLines.push(...wrappedLines);
  }

  const firstLine = `${theme.styles.dim(time)}  ${level}  ${allLines[0] ?? ""}`;

  if (allLines.length <= 1) {
    return firstLine;
  }

  // Join continuation lines with proper indentation
  const continuationLines = allLines
    .slice(1)
    .map((line) => `${MESSAGE_INDENT}${line}`)
    .join("\n");

  return `${firstLine}\n${continuationLines}`;
}

/**
 * Display function logs.
 */
function displayLogs(entries: LogEntry[]): void {
  if (entries.length === 0) {
    log.info("No logs found matching the filters.");
    return;
  }

  log.info(
    theme.styles.dim(`Showing ${entries.length} function log entries\n`)
  );

  const header = `${"TIME".padEnd(19)}  ${"LEVEL".padEnd(5)}  MESSAGE`;
  log.message(theme.styles.header(header));

  for (const entry of entries) {
    log.message(formatEntry(entry));
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
 */
async function fetchLogsForFunctions(
  functionNames: string[],
  options: LogsOptions
): Promise<LogEntry[]> {
  const filters = parseFunctionFilters(options);
  const allEntries: LogEntry[] = [];

  for (const functionName of functionNames) {
    const logs = await runTask(
      `Fetching logs for "${functionName}"...`,
      async () => {
        return await fetchFunctionLogs(functionName, filters);
      },
      {
        successMessage: `Logs for "${functionName}" fetched`,
        errorMessage: `Failed to fetch logs for "${functionName}"`,
      }
    );

    const entries = logs.map((entry) =>
      normalizeLogEntry(entry, functionName)
    );
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

  // Determine which functions to fetch logs for
  const functionNames =
    specifiedFunctions.length > 0
      ? specifiedFunctions
      : await getAllFunctionNames();

  if (functionNames.length === 0) {
    log.info("No functions found in this project.");
    return {};
  }

  let entries = await fetchLogsForFunctions(functionNames, options);

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
        { requireAuth: true },
        context
      );
    });
}
