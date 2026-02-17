import { log } from "@clack/prompts";
import { Command } from "commander";
import JSON5 from "json5";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { InvalidInputError } from "@/core/errors.js";
import { updateRecord } from "@/core/resources/entity/index.js";
import { readTextFile } from "@/core/utils/fs.js";

interface UpdateRecordCommandOptions {
  data?: string;
  file?: string;
}

async function parseUpdateData(
  options: UpdateRecordCommandOptions,
): Promise<Record<string, unknown>> {
  if (options.data) {
    try {
      return JSON5.parse(options.data);
    } catch {
      throw new InvalidInputError(
        "Invalid JSON in --data flag. Provide valid JSON.",
        {
          hints: [
            {
              message: 'Example: --data \'{"status": "active"}\'',
            },
          ],
        },
      );
    }
  }

  if (options.file) {
    const content = await readTextFile(options.file);
    try {
      return JSON5.parse(content);
    } catch {
      throw new InvalidInputError(
        `Invalid JSON in file ${options.file}. Provide a valid JSON/JSONC file.`,
      );
    }
  }

  throw new InvalidInputError(
    "Provide update data with --data or --file flag",
    {
      hints: [
        {
          message:
            'Example: --data \'{"status": "active"}\' or --file update.json',
        },
      ],
    },
  );
}

async function updateRecordAction(
  entityName: string,
  recordId: string,
  options: UpdateRecordCommandOptions,
): Promise<RunCommandResult> {
  const data = await parseUpdateData(options);

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

  log.success(`Record ${recordId} updated`);
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);

  return {};
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
