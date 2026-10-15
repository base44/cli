import type { CLIContext } from "@/cli/types.js";
import { readStdin } from "@/cli/utils/index.js";
import {
  type ApiOperation,
  groupByArea,
  type LoadedSpec,
  loadSpec,
} from "@/core/api-spec/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { readTextFile } from "@/core/utils/fs.js";

/** JSON for stdout: pretty-printed in a terminal, compact when piped. */
export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, process.stdout.isTTY ? 2 : undefined)}\n`;
}

/** A response body re-formatted as JSON when it is JSON, else as is. */
export function formatResponseBody(text: string): string {
  if (!text) {
    return "";
  }
  try {
    return formatJson(JSON.parse(text));
  } catch {
    return text.endsWith("\n") ? text : `${text}\n`;
  }
}

export function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new InvalidInputError("--limit must be a positive integer.");
  }
  return n;
}

export const REFRESH_OPTION_HELP =
  "Fetch the API spec again instead of using the cached copy (kept 1 hour)";

export function loadSpecTask(
  { runTask }: CLIContext,
  refresh: boolean | undefined,
): Promise<LoadedSpec> {
  return runTask("Loading the API spec", () => loadSpec({ refresh }), {
    successMessage: "Loaded the API spec",
  });
}

/** An area's operations; an unknown area fails with the list of real ones. */
export function operationsInArea(
  operations: ApiOperation[],
  area: string,
): ApiOperation[] {
  const areas = groupByArea(operations);
  const inArea = areas.get(area);
  if (!inArea) {
    throw new InvalidInputError(`Unknown API area: ${area}`, {
      details: [`Areas: ${[...areas.keys()].join(", ")}`],
      hints: [{ message: "List the areas", command: "base44 api catalog" }],
    });
  }
  return inArea;
}

/**
 * The body from `--body '<json>'`, `--body @file.json` or `--body @-`, else
 * piped stdin for methods that carry one.
 */
export async function readRequestBody(
  method: string,
  flag: string | undefined,
): Promise<string | undefined> {
  if (flag === "@-") {
    return readStdin("--body @-", { trim: false });
  }
  if (flag?.startsWith("@")) {
    return readTextFile(flag.slice(1));
  }
  if (flag !== undefined) {
    return flag;
  }
  if (method === "GET" || method === "HEAD" || process.stdin.isTTY) {
    return undefined;
  }
  const piped = await readStdin("--body", { trim: false });
  return piped.trim() ? piped : undefined;
}
