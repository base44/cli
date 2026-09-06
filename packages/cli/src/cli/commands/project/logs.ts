import { setTimeout as delay } from "node:timers/promises";
import type { Logger } from "@base44-cli/logger";
import type { Command } from "commander";
import { Option } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, normalizeDatetime } from "@/cli/utils/index.js";
import { ApiError, InvalidInputError } from "@/core/errors.js";
import type {
  FunctionLogFilters,
  FunctionLogsResponse,
  LogEnv,
  LogLevel,
  LogSource,
  LogStreamAttempt,
  LogStreamFilters,
  StreamEndEvent,
  StreamEvent,
  StreamLogEvent,
} from "@/core/resources/function/index.js";
import {
  fetchFunctionLogs,
  LogEnvSchema,
  LogLevelSchema,
  listDeployedFunctions,
  openLogStream,
} from "@/core/resources/function/index.js";

interface LogsOptions {
  function?: string;
  since?: string;
  until?: string;
  level?: string;
  limit?: string;
  order?: string;
  env?: LogEnv;
  follow?: boolean;
}

/**
 * Unified log entry for display, mirroring the shared log-row contract:
 * `source` is the runtime, `name` the unit inside it.
 */
export interface LogEntry {
  time: string;
  level: string;
  message: string;
  source: LogSource;
  name: string;
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

  if (options.env) {
    filters.env = options.env;
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

function formatEntry(entry: LogEntry): string {
  const time = entry.time.substring(0, 19).replace("T", " ");
  const level = entry.level.toUpperCase().padEnd(5);
  const message = entry.message.trim();
  return `${time} ${level} ${message}`;
}

export interface FollowState {
  lastTime: string;
  boundaryKeys: Set<string>;
}

function entryKey(entry: LogEntry): string {
  return `${entry.time} ${entry.message}`;
}

export function selectNewEntries(
  entries: LogEntry[],
  state: FollowState,
): { fresh: LogEntry[]; nextState: FollowState } {
  const fresh = entries.filter((e) => {
    if (e.time < state.lastTime) return false;
    if (e.time === state.lastTime && state.boundaryKeys.has(entryKey(e))) {
      return false;
    }
    return true;
  });

  if (fresh.length === 0) return { fresh, nextState: state };

  const newMax = fresh.reduce(
    (max, e) => (e.time > max ? e.time : max),
    state.lastTime,
  );
  const boundaryKeys =
    newMax === state.lastTime ? new Set(state.boundaryKeys) : new Set<string>();
  for (const e of fresh) {
    if (e.time === newMax) boundaryKeys.add(entryKey(e));
  }
  return { fresh, nextState: { lastTime: newMax, boundaryKeys } };
}

function writeFollowLine(entry: LogEntry, jsonMode: boolean): void {
  const line = jsonMode ? JSON.stringify(entry) : formatEntry(entry);
  process.stdout.write(`${line}\n`);
}

function streamEventToLogEntry(event: StreamLogEvent): LogEntry {
  return {
    time: event.time,
    level: event.level,
    message: event.name ? `[${event.name}] ${event.message}` : event.message,
    source: event.source,
    name: event.name ?? "",
  };
}

interface StreamEnding {
  lastTime: string;
  provedAlive: boolean;
  end: StreamEndEvent | null;
}

export async function printStreamUntilEnd(
  stream: AsyncGenerator<StreamEvent>,
  levelFilter: string | undefined,
  jsonMode: boolean,
  startTime: string,
): Promise<StreamEnding> {
  let lastTime = startTime;
  let provedAlive = false;
  try {
    for await (const event of stream) {
      provedAlive = true;
      if (event.kind === "end")
        return { lastTime, provedAlive, end: event.end };
      if (event.kind === "ping") continue;
      if (levelFilter && event.log.level !== levelFilter) continue;
      writeFollowLine(streamEventToLogEntry(event.log), jsonMode);
      if (event.log.time > lastTime) lastTime = event.log.time;
    }
  } catch {}
  return { lastTime, provedAlive, end: null };
}

const STREAM_RECONNECT_DELAY_MS = 1_000;
const MAX_DROPS_SINCE_LAST_EVENT = 2;
const CONNECT_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];

export const countDropTowardGivingUp = (
  dropsSinceLastEvent: number,
  provedAlive: boolean,
) => (provedAlive ? 1 : dropsSinceLastEvent + 1);

export const shouldGiveUpStreaming = (dropsSinceLastEvent: number) =>
  dropsSinceLastEvent >= MAX_DROPS_SINCE_LAST_EVENT;

async function connectWhileTransientlyUnavailable(
  filters: LogStreamFilters,
): Promise<LogStreamAttempt> {
  let attempt = await openLogStream(filters);
  for (const retryDelay of CONNECT_RETRY_DELAYS_MS) {
    if (attempt.kind !== "transient") return attempt;
    await delay(retryDelay);
    attempt = await openLogStream(filters);
  }
  return attempt;
}

async function streamUntilExhausted(
  firstStream: AsyncGenerator<StreamEvent>,
  filters: LogStreamFilters,
  options: LogsOptions,
  jsonMode: boolean,
): Promise<void> {
  let events = firstStream;
  let lastTime = "";
  let dropsSinceLastEvent = 0;
  while (true) {
    const ending = await printStreamUntilEnd(
      events,
      options.level,
      jsonMode,
      lastTime,
    );
    lastTime = ending.lastTime;
    if (ending.end) {
      if (!ending.end.retriable) return;
      dropsSinceLastEvent = 0;
    } else {
      dropsSinceLastEvent = countDropTowardGivingUp(
        dropsSinceLastEvent,
        ending.provedAlive,
      );
      if (shouldGiveUpStreaming(dropsSinceLastEvent)) return;
    }
    await delay(STREAM_RECONNECT_DELAY_MS);
    const reopened = await connectWhileTransientlyUnavailable(filters);
    if (reopened.kind !== "stream") return;
    events = reopened.events;
  }
}

function streamLostError(): ApiError {
  return new ApiError(
    "The realtime log stream stopped and could not be re-established",
    {
      hints: [
        { message: "Start a new live tail", command: "base44 logs --follow" },
        {
          message: "Or read recent logs without streaming",
          command: "base44 logs",
        },
      ],
    },
  );
}

async function followLogs(
  functionNames: string[],
  options: LogsOptions,
  availableFunctionNames: string[],
  jsonMode: boolean,
  logger: Logger,
): Promise<never> {
  const filters: LogStreamFilters = {
    functions: parseFunctionNames(options.function),
    env: options.env,
  };
  if (options.since) {
    // A stream only carries what happens from now on, so a run that asked for
    // the past polls from the start rather than opening one.
    logger.warn(
      "--since reads the past, so this run polls instead of streaming (lines may lag ~20-30s).",
    );
    return pollLogs(functionNames, options, availableFunctionNames, jsonMode, {
      lastTime: "",
      boundaryKeys: new Set(),
    });
  }
  const opened = await connectWhileTransientlyUnavailable(filters);
  if (opened.kind !== "stream") {
    logger.warn(
      opened.kind === "refused"
        ? "Realtime logs are not available for this app — falling back to polling (lines may lag ~20-30s)."
        : "Could not reach the realtime log stream — falling back to polling (lines may lag ~20-30s).",
    );
    return pollLogs(functionNames, options, availableFunctionNames, jsonMode, {
      lastTime: "",
      boundaryKeys: new Set(),
    });
  }
  await streamUntilExhausted(opened.events, filters, options, jsonMode);
  throw streamLostError();
}

async function pollLogs(
  functionNames: string[],
  options: LogsOptions,
  availableFunctionNames: string[],
  jsonMode: boolean,
  initialState: FollowState,
): Promise<never> {
  let state = initialState;
  let first = state.lastTime === "";

  while (true) {
    const pollOptions = first ? options : { ...options, since: state.lastTime };
    const entries = await fetchLogsForFunctions(
      functionNames,
      pollOptions,
      availableFunctionNames,
    );
    const { fresh, nextState } = selectNewEntries(entries, state);
    state = nextState;
    fresh.sort((a, b) => a.time.localeCompare(b.time));
    for (const entry of fresh) writeFollowLine(entry, jsonMode);
    first = false;
    await delay(2000);
  }
}

/**
 * Build function logs output (log-file style).
 */
function formatLogs(entries: LogEntry[], env: LogEnv): string {
  if (entries.length === 0) {
    if (env === "prod") {
      return "No production logs found. Has this app been published? Try --env preview to see draft logs.\n";
    }
    return "No logs found matching the filters.\n";
  }

  const header = `Showing ${entries.length} function log entries\n`;
  return [header, ...entries.map(formatEntry)].join("\n");
}

function normalizeLogEntry(
  entry: FunctionLogsResponse[number],
  functionName: string,
): LogEntry {
  return {
    time: entry.time,
    level: entry.level,
    message: `[${functionName}] ${entry.message}`,
    source: entry.source,
    name: entry.name ?? functionName,
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
      if (error instanceof ApiError && error.statusCode === 404) {
        const namesForHint = await getFunctionNamesForHint(
          availableFunctionNames,
          error,
        );
        if (namesForHint.length > 0) {
          const available = namesForHint.join(", ");
          throw new InvalidInputError(
            `Function "${functionName}" was not found in this app`,
            {
              cause: error,
              hints: [
                {
                  message: `Available functions in this app: ${available}`,
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
      }
      throw error;
    }

    // The backend does not filter by level for every runtime (per-app
    // Cloudflare deployments return the full stream), so filter defensively
    // here. Entry levels are already normalized by the response schema.
    const matchingLogs = filters.level
      ? logs.filter((entry) => entry.level === filters.level)
      : logs;

    allEntries.push(
      ...matchingLogs.map((entry) => normalizeLogEntry(entry, functionName)),
    );
  }

  // When fetching multiple functions, merge-sort the combined results
  // (each function's logs are already sorted by the backend)
  if (functionNames.length > 1) {
    const order = options.order?.toUpperCase() === "ASC" ? 1 : -1;
    allEntries.sort((a, b) => order * a.time.localeCompare(b.time));
  }

  return allEntries;
}

async function getRemoteFunctionNames(): Promise<string[]> {
  const { functions } = await listDeployedFunctions();
  return functions.map((fn) => fn.name);
}

async function getFunctionNamesForHint(
  availableFunctionNames: string[],
  logsError: ApiError,
): Promise<string[]> {
  if (availableFunctionNames.length > 0) return availableFunctionNames;
  try {
    return await getRemoteFunctionNames();
  } catch {
    throw logsError;
  }
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

async function logsAction(
  ctx: CLIContext,
  options: LogsOptions,
): Promise<RunCommandResult> {
  validateLimit(options.limit);
  const specifiedFunctions = parseFunctionNames(options.function);
  const availableFunctionNames =
    specifiedFunctions.length === 0 ? await getRemoteFunctionNames() : [];
  const functionNames =
    specifiedFunctions.length > 0 ? specifiedFunctions : availableFunctionNames;

  if (functionNames.length === 0) {
    return { outroMessage: "No functions found in this app." };
  }

  if (options.follow) {
    if (options.until) {
      throw new InvalidInputError(
        "--until cannot be combined with --follow (a stream has no end).",
      );
    }
    if (options.order) {
      throw new InvalidInputError(
        "--order cannot be combined with --follow (a live tail always streams oldest to newest).",
      );
    }
    options.order = "asc"; // tail reads oldest -> newest
    return followLogs(
      functionNames,
      options,
      availableFunctionNames,
      ctx.jsonMode,
      ctx.log,
    );
  }

  let entries = await fetchLogsForFunctions(
    functionNames,
    options,
    availableFunctionNames,
  );

  // Apply limit after merging logs from all functions
  const limit = options.limit ? Number.parseInt(options.limit, 10) : undefined;
  if (limit !== undefined && entries.length > limit) {
    entries = entries.slice(0, limit);
  }

  const env = options.env ?? "preview";
  const logsOutput = ctx.jsonMode
    ? `${JSON.stringify(entries, null, 2)}\n`
    : formatLogs(entries, env);

  const shouldOutputOutroMessage = !ctx.jsonMode;
  return {
    outroMessage: shouldOutputOutroMessage ? "Fetched logs" : undefined,
    stdout: logsOutput,
  };
}

export function getLogsCommand(): Command {
  return new Base44Command("logs")
    .description("Fetch function logs for this app")
    .option(
      "--function <names>",
      "Filter by function name(s), comma-separated. If omitted, fetches logs for all deployed functions",
    )
    .option(
      "--since <datetime>",
      "Show logs from this time. ISO datetime or relative shorthand (e.g. 1h, 30m, 2d)",
      normalizeDatetime,
    )
    .option(
      "--until <datetime>",
      "Show logs until this time. ISO datetime or relative shorthand (e.g. 1h, 30m, 2d)",
      normalizeDatetime,
    )
    .addOption(
      new Option("--level <level>", "Filter by log level").choices([
        ...LogLevelSchema.options,
      ]),
    )
    .option(
      "-n, --limit <n>",
      "Results per page (1-1000; the server returns at most 500)",
    )
    .option("-f, --follow", "Stream new logs as they arrive")
    .addOption(
      new Option("--order <order>", "Sort order").choices(["asc", "desc"]),
    )
    .addOption(
      new Option(
        "--env <env>",
        "Which deployment to read logs from: preview (current draft) or prod (published). Default: preview",
      ).choices([...LogEnvSchema.options]),
    )
    .action(logsAction);
}
