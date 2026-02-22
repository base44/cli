import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { getRecord } from "@/core/resources/entity/index.js";

async function getRecordAction(
  entityName: string,
  recordId: string,
): Promise<RunCommandResult> {
  const record = await runTask(
    `Fetching ${entityName} record...`,
    async () => {
      return await getRecord(entityName, recordId);
    },
    {
      successMessage: `Fetched ${entityName} record`,
      errorMessage: `Failed to fetch ${entityName} record`,
    },
  );

  log.info(JSON.stringify(record, null, 2));

  return {};
}

export function getRecordsGetCommand(context: CLIContext): Command {
  return new Command("get")
    .description("Get a single entity record by ID")
    .argument("<entity-name>", "Name of the entity (e.g. Users, Products)")
    .argument("<record-id>", "ID of the record")
    .action(async (entityName: string, recordId: string) => {
      await runCommand(
        () => getRecordAction(entityName, recordId),
        { requireAuth: true },
        context,
      );
    });
}
