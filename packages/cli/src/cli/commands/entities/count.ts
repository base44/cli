import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask } from "@/cli/utils/index.js";
import { countEntityRecords } from "@/core/resources/entity/data-api.js";

async function countAction(
  _ctx: CLIContext,
  entityName: string,
): Promise<RunCommandResult> {
  const count = await runTask(
    `Counting ${entityName} records...`,
    async () => countEntityRecords(entityName),
    { errorMessage: `Failed to count ${entityName} records` },
  );

  return {
    outroMessage: `${entityName} has ${count} record${count !== 1 ? "s" : ""}`,
  };
}

export function getEntitiesCountCommand(): Command {
  return new Base44Command("count")
    .description("Count total records for an entity")
    .argument("<entityName>", "Name of the entity")
    .action(countAction);
}
