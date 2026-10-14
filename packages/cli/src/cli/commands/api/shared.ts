import type { CLIContext } from "@/cli/types.js";
import { type LoadedSpec, loadSpec } from "@/core/api-spec/index.js";
import { InvalidInputError } from "@/core/errors.js";

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
