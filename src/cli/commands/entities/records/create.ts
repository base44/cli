import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { createRecord } from "@/core/resources/entity/index.js";
import { parseRecordData } from "./parseRecordData.js";

interface CreateRecordCommandOptions {
  data?: string;
  file?: string;
}

async function createRecordAction(
  entityName: string,
  options: CreateRecordCommandOptions,
): Promise<RunCommandResult> {
  const data = await parseRecordData(
    options,
    '{"name": "John", "email": "john@example.com"}',
  );

  const record = await runTask(
    `Creating ${entityName} record...`,
    async () => {
      return await createRecord(entityName, data);
    },
    {
      successMessage: `Created ${entityName} record`,
      errorMessage: `Failed to create ${entityName} record`,
    },
  );

  log.info(JSON.stringify(record, null, 2));

  return { outroMessage: `Record created with ID: ${record.id}` };
}

export function getRecordsCreateCommand(context: CLIContext): Command {
  return new Command("create")
    .description("Create a new entity record")
    .argument("<entity-name>", "Name of the entity (e.g. Users, Products)")
    .option("-d, --data <json>", "JSON object with record data")
    .option("--file <path>", "Read record data from a JSON/JSONC file")
    .action(async (entityName: string, options: CreateRecordCommandOptions) => {
      await runCommand(
        () => createRecordAction(entityName, options),
        { requireAuth: true },
        context,
      );
    });
}
