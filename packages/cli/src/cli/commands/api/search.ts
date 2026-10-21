import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { listOperations, searchOperations } from "@/core/api-spec/index.js";
import {
  formatJson,
  loadSpecTask,
  parseLimit,
  READ_ONLY_FILTER_HELP,
  REFRESH_OPTION_HELP,
} from "./shared.js";

interface SearchOptions {
  limit?: string;
  readOnly?: boolean;
  refresh?: boolean;
}

async function searchAction(
  ctx: CLIContext,
  words: string[],
  options: SearchOptions,
): Promise<RunCommandResult> {
  const limit = parseLimit(options.limit);
  const { spec } = await loadSpecTask(ctx, options.refresh);
  const results = searchOperations(listOperations(spec), words.join(" "), {
    limit,
    readOnly: options.readOnly,
  });
  return { stdout: formatJson(results) };
}

export function getApiSearchCommand(): Command {
  return new Base44Command("search", {
    requireAuth: false,
    requireAppContext: false,
  })
    .description("Search every Base44 API operation by what it does")
    .argument(
      "<text...>",
      'What you are looking for, e.g. "failed workflow runs"',
    )
    .option("--limit <n>", "Most results to return (default 5)")
    .option("--read-only", READ_ONLY_FILTER_HELP)
    .option("--refresh", REFRESH_OPTION_HELP)
    .action(searchAction);
}
