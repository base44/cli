import { log } from "@clack/prompts";
import { Command, Option } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { ApiError, InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/index.js";
import type {
  FunctionLogEntry,
  FunctionLogFilters,
  FunctionLogsResponse,
  LogLevel,
  StreamLogFilters,
} from "@/core/resources/function/index.js";
import {
  fetchFunctionLogs,
  LogLevelSchema,
  streamFunctionLogs,
} from "@/core/resources/function/index.js";

interface LogsOptions {
  function?: string;
  since?: string;
  until?: string;
  level?: string;
  limit?: string;
  order?: string;
  json?: boolean;
  tail?: boolean;
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

function parseFunctionNames(option: string | undefined): string[] {
  if (!option) return [];
  return option
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function normalizeDatetime(value: string): string {
  if (/Z$|[+-]\d{2}:\d{2}$/.test(value)) return value;
  return `${value}Z`;
}

function formatEntry(entry: LogEntry): string {
  const time = entry.time.substring(0, 19).replace("T", " ");
  const level = entry.level.toUpperCase().padEnd(5);
  const message = entry.message.trim();
  return `${time} ${level} ${message}`;
}

/**
 * Build function logs output (log-file style).
 */
function formatLogs(entries: LogEntry[]): string {
  if (entries.length === 0) {
    return "No logs found matching the filters.\n";
  }

  const header = `Showing ${entries.length} function log entries\n`;
  return [header, ...entries.map(formatEntry)].join("\n");
}

function normalizeLogEntry(
  entry: { time: string; level: string; message: string },
  functionName: string,
): LogEntry {
  return {
    time: entry.time,
    level: entry.level,
    message: `[${functionName}] ${entry.message}`,
    source: functionName,
  };
}

async function fetchLogsForFunctions(
  functionNames: string[],
  options: LogsOptions,
  availableFunctionNames: string[],
): Promise<LogEntry[]> {
  const filters = parseFunctionFilters(options);
  const allEntries: LogEntry[] = [];

  for (const functionName of functionNames) {
    let logs: FunctionLogsResponse;
    try {
      logs = await fetchFunctionLogs(functionName, filters);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.statusCode === 404 &&
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
          },
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

async function getAllFunctionNames(): Promise<string[]> {
  const { functions } = await readProjectConfig();
  return functions.map((fn) => fn.name);
}

function validateLimit(limit: string | undefined): void {
  if (limit === undefined) return;
  const n = Number.parseInt(limit, 10);
  if (Number.isNaN(n) || n < 1 || n > 1000) {
    throw new InvalidInputError(
      `Invalid limit: "${limit}". Must be a number between 1 and 1000.`,
    );
  }
}

function validateTailFlags(options: LogsOptions): void {
  if (!options.tail) return;

  const incompatible: [string, string | undefined][] = [
    ["--since", options.since],
    ["--until", options.until],
    ["--limit", options.limit],
    ["--order", options.order],
  ];

  for (const [flag, value] of incompatible) {
    if (value !== undefined) {
      throw new InvalidInputError(`Cannot use ${flag} with --tail`);
    }
  }
}

function formatStreamEntry(
  entry: FunctionLogEntry,
  functionName: string,
  json: boolean,
): string {
  if (json) {
    return JSON.stringify({
      source: functionName,
      time: entry.time,
      level: entry.level,
      message: entry.message,
    });
  }
  const normalized = normalizeLogEntry(entry, functionName);
  return formatEntry(normalized);
}

async function consumeStream(
  functionName: string,
  filters: StreamLogFilters,
  signal: AbortSignal,
  json: boolean,
): Promise<"ended" | "aborted"> {
  try {
    for await (const entry of streamFunctionLogs(
      functionName,
      filters,
      signal,
    )) {
      process.stdout.write(`${formatStreamEntry(entry, functionName, json)}\n`);
    }
    return "ended";
  } catch (error) {
    if (signal.aborted) return "aborted";
    throw error;
  }
}

async function tailAction(options: LogsOptions): Promise<RunCommandResult> {
  validateTailFlags(options);

  const specifiedFunctions = parseFunctionNames(options.function);
  const allProjectFunctions = await getAllFunctionNames();
  const functionNames =
    specifiedFunctions.length > 0 ? specifiedFunctions : allProjectFunctions;

  if (functionNames.length === 0) {
    return { outroMessage: "No functions found in this project." };
  }

  const filters: StreamLogFilters = {};
  if (options.level) {
    filters.level = options.level as LogLevel;
  }

  const json = options.json ?? false;
  const functionList = functionNames.join(", ");
  log.info(`Tailing logs for ${functionList}... (Ctrl+C to stop)`);

  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.on("SIGINT", onSigint);

  let userAborted = false;

  try {
    if (functionNames.length === 1) {
      const result = await consumeStream(
        functionNames[0],
        filters,
        controller.signal,
        json,
      );
      userAborted = result === "aborted";
    } else {
      const results = await Promise.allSettled(
        functionNames.map((fn) =>
          consumeStream(fn, filters, controller.signal, json),
        ),
      );

      const allFailed = results.every((r) => r.status === "rejected");

      if (allFailed && !controller.signal.aborted) {
        const firstError = results.find(
          (r) => r.status === "rejected",
        ) as PromiseRejectedResult;
        throw firstError.reason;
      }

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "rejected" && !controller.signal.aborted) {
          log.warn(`Connection lost for function '${functionNames[i]}'`);
        }
      }

      userAborted = controller.signal.aborted;
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
  }

  return {
    outroMessage: userAborted ? "Stream closed" : "Stream ended",
  };
}

async function logsAction(options: LogsOptions): Promise<RunCommandResult> {
  validateLimit(options.limit);
  const specifiedFunctions = parseFunctionNames(options.function);

  // Always read project functions so we can list them in error messages
  const allProjectFunctions = await getAllFunctionNames();

  // Determine which functions to fetch logs for
  const functionNames =
    specifiedFunctions.length > 0 ? specifiedFunctions : allProjectFunctions;

  if (functionNames.length === 0) {
    return { outroMessage: "No functions found in this project." };
  }

  let entries = await fetchLogsForFunctions(
    functionNames,
    options,
    allProjectFunctions,
  );

  // Apply limit after merging logs from all functions
  const limit = options.limit ? Number.parseInt(options.limit, 10) : undefined;
  if (limit !== undefined && entries.length > limit) {
    entries = entries.slice(0, limit);
  }

  const logsOutput = options.json
    ? `${JSON.stringify(entries, null, 2)}\n`
    : formatLogs(entries);

  return { outroMessage: "Fetched logs", stdout: logsOutput };
}

export function getLogsCommand(context: CLIContext): Command {
  return new Command("logs")
    .description(
      "Fetch function logs for this app (use --tail to stream in real-time)",
    )
    .option(
      "--function <names>",
      "Filter by function name(s), comma-separated. If omitted, fetches logs for all project functions",
    )
    .option(
      "--since <datetime>",
      "Show logs from this time (ISO format)",
      normalizeDatetime,
    )
    .option(
      "--until <datetime>",
      "Show logs until this time (ISO format)",
      normalizeDatetime,
    )
    .addOption(
      new Option("--level <level>", "Filter by log level")
        .choices([...LogLevelSchema.options])
        .hideHelp(),
    )
    .option("-n, --limit <n>", "Results per page (1-1000, default: 50)")
    .addOption(
      new Option("--order <order>", "Sort order").choices(["asc", "desc"]),
    )
    .option("--json", "Output raw JSON")
    .option("-f, --tail", "Stream logs in real-time")
    .action(async (options: LogsOptions) => {
      const action = options.tail
        ? () => tailAction(options)
        : () => logsAction(options);
      await runCommand(action, { requireAuth: true }, context);
    });
}
