import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/index.js";
import type {
  AuditLogEvent,
  AuditLogFilters,
  AuditLogsResponse,
} from "@/core/logs/index.js";
import { fetchAuditLogs } from "@/core/logs/index.js";
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
 * Unified log entry for display (normalized from both sources).
 */
interface UnifiedLogEntry {
  time: string;
  level: string;
  message: string;
  source: string; // "App" for audit logs, function name for function logs
}

/**
 * Counts for display header (audit vs function breakdown and pagination).
 */
interface LogCounts {
  auditCount: number;
  functionCount: number;
  auditTotal?: number;
  hasMore?: boolean;
}

// ─── CONSTANTS ──────────────────────────────────────────────

const VALID_LEVELS = ["log", "info", "warn", "error", "debug"];

// ─── AUDIT LOG MESSAGE FORMATTING ───────────────────────────

/**
 * Format an audit log event into a human-readable message.
 */
function formatAuditMessage(event: AuditLogEvent): string {
  const m = (event.metadata ?? {}) as Record<string, unknown>;
  const isFailure = event.status === "failure";

  switch (event.event_type) {
    // Function calls
    case "api.function.call": {
      const fnName = m.function_name ?? "unknown";
      const statusCode = m.status_code ?? "";
      return isFailure
        ? `function ${fnName} failed (status ${statusCode})`
        : `function ${fnName} called (status ${statusCode})`;
    }

    // Entity operations
    case "app.entity.created": {
      const entity = m.entity_name ?? "unknown";
      const id = m.entity_id ?? "";
      return isFailure
        ? `failed to create entity ${entity}`
        : `entity ${entity} created (id: ${id})`;
    }
    case "app.entity.updated": {
      const entity = m.entity_name ?? "unknown";
      const id = m.entity_id ?? "";
      return isFailure
        ? `failed to update entity ${entity}`
        : `entity ${entity} updated (id: ${id})`;
    }
    case "app.entity.deleted": {
      const entity = m.entity_name ?? "unknown";
      const id = m.entity_id ?? "";
      return isFailure
        ? `failed to delete entity ${entity}`
        : `entity ${entity} deleted (id: ${id})`;
    }
    case "app.entity.bulk_created": {
      const entity = m.entity_name ?? "unknown";
      const count = m.count ?? 0;
      const method = m.method ?? "";
      return isFailure
        ? `bulk create failed for ${entity}`
        : `${count} ${entity} entities created via ${method}`;
    }
    case "app.entity.bulk_deleted": {
      const entity = m.entity_name ?? "unknown";
      const count = m.count ?? 0;
      const method = m.method ?? "";
      return isFailure
        ? `bulk delete failed for ${entity}`
        : `${count} ${entity} entities deleted via ${method}`;
    }
    case "app.entity.query": {
      const entity = m.entity_name ?? "unknown";
      return isFailure ? `query failed for ${entity}` : `queried ${entity}`;
    }

    // User operations (always success)
    case "app.user.registered": {
      const email = m.target_email ?? "unknown";
      const role = m.role ?? "";
      return `user ${email} registered as ${role}`;
    }
    case "app.user.updated": {
      const email = m.target_email ?? "unknown";
      return `user ${email} updated`;
    }
    case "app.user.deleted": {
      const email = m.target_email ?? "unknown";
      return `user ${email} deleted`;
    }
    case "app.user.role_changed": {
      const email = m.target_email ?? "unknown";
      const oldRole = m.old_role ?? "";
      const newRole = m.new_role ?? "";
      return `user ${email} role changed: ${oldRole} → ${newRole}`;
    }
    case "app.user.invited": {
      const email = m.invitee_email ?? "unknown";
      const role = m.role ?? "";
      return `invited ${email} as ${role}`;
    }
    case "app.user.page_visit": {
      const page = m.page_name ?? "unknown";
      return `page visit: ${page}`;
    }

    // Auth operations (always success)
    case "app.auth.login": {
      const method = m.auth_method ?? "unknown";
      return `login via ${method}`;
    }

    // Access operations (always success)
    case "app.access.requested": {
      const email = m.requester_email ?? "unknown";
      return `access requested by ${email}`;
    }
    case "app.access.approved": {
      const email = m.target_email ?? "unknown";
      return `access approved for ${email}`;
    }
    case "app.access.denied": {
      const email = m.target_email ?? "unknown";
      return `access denied for ${email}`;
    }

    // Automation & Integration (can fail)
    case "app.automation.executed": {
      const name = m.automation_name ?? "unknown";
      return isFailure
        ? `automation ${name} failed`
        : `automation ${name} executed`;
    }
    case "app.integration.executed": {
      const name = m.integration_name ?? "unknown";
      const action = m.action ?? "";
      const duration = m.duration_ms ?? "";
      return isFailure
        ? `integration ${name} failed: ${action}`
        : `integration ${name}: ${action} (${duration}ms)`;
    }

    // Agent conversation (always success)
    case "app.agent.conversation": {
      const name = m.agent_name ?? "unknown";
      const model = m.model ?? "";
      return `agent ${name} conversation (${model})`;
    }

    // Fallback for unknown event types
    default:
      return isFailure ? `${event.event_type} failed` : event.event_type;
  }
}

/**
 * Normalize an audit log event to unified format.
 */
function normalizeAuditLog(event: AuditLogEvent): UnifiedLogEntry {
  const level = event.status === "failure" ? "error" : "info";
  const message = formatAuditMessage(event);
  return { time: event.timestamp, level, message, source: "App" };
}

/**
 * Normalize a function log entry to unified format.
 */
function normalizeFunctionLog(
  entry: { time: string; level: string; message: string },
  functionName: string
): UnifiedLogEntry {
  return {
    time: entry.time,
    level: entry.level,
    message: `[${functionName}] ${entry.message}`,
    source: functionName,
  };
}

// ─── OPTION PARSING ─────────────────────────────────────────

/**
 * Map --level to audit log status filter.
 * - log/info → success
 * - error → failure
 * - debug/warn → skip audit logs (returns null; audit has no warn level)
 */
function mapLevelToStatus(
  level: string | undefined
): "success" | "failure" | null | undefined {
  if (!level) return undefined; // No filter
  if (level === "debug" || level === "warn") return null; // Skip audit logs
  if (level === "log" || level === "info") return "success";
  if (level === "error") return "failure";
  return undefined;
}

/**
 * Parse CLI options into AuditLogFilters.
 */
function parseAuditFilters(options: LogsOptions): AuditLogFilters {
  const filters: AuditLogFilters = {};

  // Map level to status
  const status = mapLevelToStatus(options.level);
  if (status) {
    filters.status = status;
  }

  if (options.since) {
    filters.since = options.since;
  }

  if (options.until) {
    filters.until = options.until;
  }

  if (options.limit) {
    filters.limit = Number.parseInt(options.limit, 10);
  }

  if (options.order) {
    filters.order = options.order.toUpperCase() as "ASC" | "DESC";
  }

  return filters;
}

/**
 * Check if audit logs should be fetched based on level filter.
 */
function shouldFetchAuditLogs(level: string | undefined): boolean {
  return mapLevelToStatus(level) !== null;
}

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
 * Format a unified log entry for display.
 * Preserves original newlines in the message and wraps long lines.
 */
function formatEntry(entry: UnifiedLogEntry): string {
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
 * Display unified logs with count breakdown.
 */
function displayLogs(entries: UnifiedLogEntry[], counts: LogCounts): void {
  if (entries.length === 0) {
    log.info("No logs found matching the filters.");
    return;
  }

  const { auditCount, functionCount, auditTotal, hasMore } = counts;
  let countInfo: string;
  if (auditCount > 0 && functionCount > 0) {
    countInfo = `Showing ${entries.length} log entries (${auditCount} app events, ${functionCount} function logs)`;
  } else if (auditCount > 0 && auditTotal !== undefined) {
    countInfo = `Showing ${entries.length} of ${auditTotal} app events`;
  } else if (functionCount > 0) {
    countInfo = `Showing ${entries.length} function log entries`;
  } else {
    countInfo = `Showing ${entries.length} log entries`;
  }
  log.info(theme.styles.dim(`${countInfo}\n`));

  const header = `${"TIME".padEnd(19)}  ${"LEVEL".padEnd(5)}  MESSAGE`;
  log.message(theme.styles.header(header));

  // Entries
  for (const entry of entries) {
    log.message(formatEntry(entry));
  }

  if (hasMore) {
    log.info(
      theme.styles.dim("\nMore results available. Use --limit to fetch more.")
    );
  }
}

// ─── ACTIONS ────────────────────────────────────────────────

/**
 * Fetch and display audit logs.
 */
async function fetchAuditLogsAction(options: LogsOptions): Promise<{
  entries: UnifiedLogEntry[];
  pagination: AuditLogsResponse["pagination"];
}> {
  const filters = parseAuditFilters(options);

  const response = await runTask(
    "Fetching app logs...",
    async () => {
      return await fetchAuditLogs(filters);
    },
    {
      successMessage: "Logs fetched successfully",
      errorMessage: "Failed to fetch app logs",
    }
  );

  const entries = response.events.map(normalizeAuditLog);
  return { entries, pagination: response.pagination };
}

/**
 * Fetch and display function logs.
 */
async function fetchFunctionLogsAction(
  functionNames: string[],
  options: LogsOptions
): Promise<UnifiedLogEntry[]> {
  const filters = parseFunctionFilters(options);
  const allEntries: UnifiedLogEntry[] = [];

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

    // Filter by level if specified (API doesn't support level filtering)
    const filteredLogs = filters.level
      ? logs.filter((entry) => entry.level === filters.level)
      : logs;

    const entries = filteredLogs.map((entry) =>
      normalizeFunctionLog(entry, functionName)
    );
    allEntries.push(...entries);
  }

  // Sort by time (respecting order option)
  const order = options.order?.toUpperCase() === "ASC" ? 1 : -1;
  allEntries.sort((a, b) => order * a.time.localeCompare(b.time));

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
  const allEntries: UnifiedLogEntry[] = [];
  let pagination: AuditLogsResponse["pagination"] | undefined;

  if (specifiedFunctions.length > 0) {
    // --function specified: fetch only those function logs (no audit logs)
    const entries = await fetchFunctionLogsAction(specifiedFunctions, options);
    allEntries.push(...entries);
  } else {
    // No --function: fetch both audit logs and all project function logs

    // Fetch audit logs (unless --level=debug)
    if (shouldFetchAuditLogs(options.level)) {
      const result = await fetchAuditLogsAction(options);
      allEntries.push(...result.entries);
      pagination = result.pagination;
    }

    // Fetch all project function logs
    const functionNames = await getAllFunctionNames();
    if (functionNames.length > 0) {
      const functionEntries = await fetchFunctionLogsAction(
        functionNames,
        options
      );
      allEntries.push(...functionEntries);
    }

    // Sort combined entries by time
    const order = options.order?.toUpperCase() === "ASC" ? 1 : -1;
    allEntries.sort((a, b) => order * a.time.localeCompare(b.time));
  }

  const limit = options.limit ? Number.parseInt(options.limit, 10) : undefined;
  if (limit !== undefined && allEntries.length > limit) {
    allEntries.length = limit;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(allEntries, null, 2)}\n`);
  } else {
    const auditCount = allEntries.filter((e) => e.source === "App").length;
    const functionCount = allEntries.length - auditCount;
    const counts: LogCounts = {
      auditCount,
      functionCount,
      auditTotal: functionCount === 0 ? pagination?.total : undefined,
      hasMore: functionCount === 0 ? pagination?.has_more : undefined,
    };
    displayLogs(allEntries, counts);
  }

  return {};
}

// ─── COMMAND ────────────────────────────────────────────────

export function getLogsCommand(context: CLIContext): Command {
  return new Command("logs")
    .description("Fetch logs for this app (app logs + all function logs)")
    .option(
      "--function <names>",
      "Filter by function name(s), comma-separated. If provided, fetches only those function logs"
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
