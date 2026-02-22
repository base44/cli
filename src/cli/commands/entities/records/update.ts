import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { updateRecord } from "@/core/resources/entity/index.js";
import { parseRecordData } from "./parseRecordData.js";

interface UpdateRecordCommandOptions {
  data?: string;
  file?: string;
}

async function updateRecordAction(
  entityName: string,
  recordId: string,
  options: UpdateRecordCommandOptions,
): Promise<RunCommandResult> {
  const data = await parseRecordData(options, '{"status": "active"}');

  const record = await runTask(
    `Updating ${entityName} record...`,
    async () => {
      return await updateRecord(entityName, recordId, data);
    },
    {
      successMessage: `Updated ${entityName} record`,
      errorMessage: `Failed to update ${entityName} record`,
    },
  );

  log.info(JSON.stringify(record, null, 2));

  return { outroMessage: `Record ${recordId} updated` };
}

export function getRecordsUpdateCommand(context: CLIContext): Command {
  return new Command("update")
    .description("Update an entity record")
    .argument("<entity-name>", "Name of the entity (e.g. Users, Products)")
    .argument("<record-id>", "ID of the record to update")
    .option("-d, --data <json>", "JSON object with fields to update")
    .option("--file <path>", "Read update data from a JSON/JSONC file")
    .action(
      async (
        entityName: string,
        recordId: string,
        options: UpdateRecordCommandOptions,
      ) => {
        await runCommand(
          () => updateRecordAction(entityName, recordId, options),
          { requireAuth: true },
          context,
        );
      },
    );
}
