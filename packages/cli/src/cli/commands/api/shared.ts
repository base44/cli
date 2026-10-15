import { fstatSync } from "node:fs";
import type { CLIContext } from "@/cli/types.js";
import { type Logger, readStdin, toJsonStdout } from "@/cli/utils/index.js";
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
  return toJsonStdout(value, { compact: !process.stdout.isTTY });
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

export const READ_ONLY_FILTER_HELP = "Only read-only operations";

export const REFRESH_OPTION_HELP =
  "Fetch the API spec again instead of using the cached copy (kept 1 hour)";

/**
 * Run a step with a spinner in a terminal and silently otherwise: an agent
 * reading stderr pays tokens for every status line.
 */
export function quietTask<T>(
  { runTask, isNonInteractive }: CLIContext,
  label: string,
  operation: () => Promise<T>,
  messages: { successMessage: string; errorMessage?: string },
): Promise<T> {
  return isNonInteractive ? operation() : runTask(label, operation, messages);
}

export function loadSpecTask(
  ctx: CLIContext,
  refresh: boolean | undefined,
): Promise<LoadedSpec> {
  return quietTask(ctx, "Loading the API spec", () => loadSpec({ refresh }), {
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

/** Stdin is a shell pipe or a redirected file; checking reads nothing from it. */
function isPipedStdin(): boolean {
  try {
    const stats = fstatSync(0);
    return stats.isFIFO() || stats.isFile();
  } catch {
    return false;
  }
}

/**
 * The body from `--body '<json>'`, `--body @file.json` or `--body @-`. Stdin
 * is read only for `@-`: a harness can hold stdin open forever, so reading it
 * unasked could hang the call.
 */
export async function readRequestBody(
  flag: string | undefined,
  log: Logger,
): Promise<string | undefined> {
  if (flag === "@-") {
    return readStdin("--body @-", { trim: false });
  }
  if (flag?.startsWith("@")) {
    return readTextFile(flag.slice(1));
  }
  if (flag === undefined && isPipedStdin()) {
    log.warn("stdin is ignored; pass --body @- to send it as the body.");
  }
  return flag;
}
