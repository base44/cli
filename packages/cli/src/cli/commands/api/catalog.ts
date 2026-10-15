import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import {
  areaListing,
  catalogIndex,
  listOperations,
} from "@/core/api-spec/index.js";
import {
  formatJson,
  loadSpecTask,
  operationsInArea,
  READ_ONLY_FILTER_HELP,
  REFRESH_OPTION_HELP,
} from "./shared.js";

async function catalogAction(
  ctx: CLIContext,
  area: string | undefined,
  options: { readOnly?: boolean; refresh?: boolean },
): Promise<RunCommandResult> {
  const { spec } = await loadSpecTask(ctx, options.refresh);
  const operations = listOperations(spec).filter(
    (op) => !options.readOnly || op.readOnly,
  );
  if (area === undefined) {
    return { stdout: formatJson(catalogIndex(operations)) };
  }
  return {
    stdout: formatJson(areaListing(area, operationsInArea(operations, area))),
  };
}

export function getApiCatalogCommand(): Command {
  return new Base44Command("catalog", {
    requireAuth: false,
    requireAppContext: false,
  })
    .description("List the API's areas, or every operation in one area")
    .argument("[area]", 'An area from the list, e.g. "workflows"')
    .option("--read-only", READ_ONLY_FILTER_HELP)
    .option("--refresh", REFRESH_OPTION_HELP)
    .action(catalogAction);
}
