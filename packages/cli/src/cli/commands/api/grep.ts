import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { grepSpec, listOperations } from "@/core/api-spec/index.js";
import { InvalidInputError } from "@/core/errors.js";
import {
  formatJson,
  loadSpecTask,
  operationsInArea,
  parseLimit,
  REFRESH_OPTION_HELP,
} from "./shared.js";

interface GrepOptions {
  area?: string;
  ignoreCase?: boolean;
  limit?: string;
  refresh?: boolean;
}

function assertValidRegex(pattern: string): void {
  try {
    new RegExp(pattern);
  } catch (error) {
    throw new InvalidInputError(
      `Invalid regular expression: ${error instanceof Error ? error.message : pattern}`,
    );
  }
}

async function grepAction(
  ctx: CLIContext,
  pattern: string,
  options: GrepOptions,
): Promise<RunCommandResult> {
  const limit = parseLimit(options.limit);
  assertValidRegex(pattern);
  const { spec } = await loadSpecTask(ctx, options.refresh);
  const operations = listOperations(spec);
  if (options.area !== undefined) {
    operationsInArea(operations, options.area);
  }
  const hits = grepSpec(spec, operations, pattern, {
    area: options.area,
    ignoreCase: options.ignoreCase,
    limit,
  });
  return { stdout: formatJson(hits) };
}

export function getApiGrepCommand(): Command {
  return new Base44Command("grep", {
    requireAuth: false,
    requireAppContext: false,
  })
    .description(
      "Search the raw API spec with a regular expression, for when search misses",
    )
    .argument("<pattern>", 'Regular expression, e.g. "runs.*status"')
    .option(
      "--area <area>",
      "Search only one area's operations (see base44 api catalog)",
    )
    .option("-i, --ignore-case", "Case-insensitive match")
    .option("--limit <n>", "Most operations or schemas to return (default 20)")
    .option("--refresh", REFRESH_OPTION_HELP)
    .action(grepAction);
}
