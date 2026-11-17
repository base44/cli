import { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { listEntitySchemas } from "@/core/resources/entity/index.js";

async function listEntitiesAction({ jsonMode }: CLIContext): Promise<RunCommandResult> {
  const catalog = await listEntitySchemas();
  return { stdout: jsonMode ? `${JSON.stringify(catalog)}\n` : undefined, outroMessage: jsonMode ? undefined : JSON.stringify(catalog, null, 2) };
}

export function getEntitiesListCommand(): Command {
  return new Base44Command("list")
    .description("List remote entity schemas (read-only)")
    .action(listEntitiesAction);
}
