import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask } from "@/cli/utils/index.js";
import { getEntityRecord } from "@/core/resources/entity/data-api.js";

async function getAction(
  _ctx: CLIContext,
  entityName: string,
  id: string,
): Promise<RunCommandResult> {
  const record = await runTask(
    `Fetching ${entityName} record...`,
    async () => getEntityRecord(entityName, id),
    { errorMessage: `Failed to fetch ${entityName} record "${id}"` },
  );

  const formatted = JSON.stringify(record, null, 2);

  return {
    outroMessage: `Fetched ${entityName} record ${id}`,
    stdout: `${formatted}\n`,
  };
}

export function getEntitiesGetCommand(): Command {
  return new Base44Command("get")
    .description("Get a single entity record by ID")
    .argument("<entityName>", "Name of the entity")
    .argument("<id>", "Record ID")
    .action(getAction);
}
