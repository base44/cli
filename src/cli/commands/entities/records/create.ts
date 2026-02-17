import { log } from "@clack/prompts";
import { Command } from "commander";
import JSON5 from "json5";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { InvalidInputError } from "@/core/errors.js";
import { createRecord } from "@/core/resources/entity/index.js";
import { readTextFile } from "@/core/utils/fs.js";

interface CreateRecordCommandOptions {
  data?: string;
  file?: string;
}

async function parseRecordData(
  options: CreateRecordCommandOptions,
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
              message:
                'Example: --data \'{"name": "John", "email": "john@example.com"}\'',
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
    "Provide record data with --data or --file flag",
    {
      hints: [
        {
          message:
            'Example: --data \'{"name": "John"}\' or --file record.json',
        },
      ],
    },
  );
}

async function createRecordAction(
  entityName: string,
  options: CreateRecordCommandOptions,
): Promise<RunCommandResult> {
  const data = await parseRecordData(options);

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

  log.success(`Record created with ID: ${record.id}`);
  console.log(JSON.stringify(record, null, 2));

  return {};
}

export function getRecordsCreateCommand(context: CLIContext): Command {
  return new Command("create")
    .description("Create a new entity record")
    .argument("<entity-name>", "Name of the entity (e.g. Users, Products)")
    .option("-d, --data <json>", "JSON object with record data")
    .option("--file <path>", "Read record data from a JSON/JSONC file")
    .action(
      async (entityName: string, options: CreateRecordCommandOptions) => {
        await runCommand(
          () => createRecordAction(entityName, options),
          { requireAuth: true },
          context,
        );
      },
    );
}
