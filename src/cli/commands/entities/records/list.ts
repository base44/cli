import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { listRecords } from "@/core/resources/entity/index.js";

interface ListRecordsCommandOptions {
  filter?: string;
  sort?: string;
  limit?: string;
  skip?: string;
  fields?: string;
}

async function listRecordsAction(
  entityName: string,
  options: ListRecordsCommandOptions,
): Promise<RunCommandResult> {
  const records = await runTask(
    `Fetching ${entityName} records...`,
    async () => {
      return await listRecords(entityName, {
        filter: options.filter,
        sort: options.sort,
        limit: options.limit ? Number(options.limit) : 50,
        skip: options.skip ? Number(options.skip) : undefined,
        fields: options.fields,
      });
    },
    {
      successMessage: `Fetched ${entityName} records`,
      errorMessage: `Failed to fetch ${entityName} records`,
    },
  );

  log.info(`Found ${records.length} record(s)`);
  console.log(JSON.stringify(records, null, 2));

  return {};
}

export function getRecordsListCommand(context: CLIContext): Command {
  return new Command("list")
    .description("List entity records")
    .argument("<entity-name>", "Name of the entity (e.g. Users, Products)")
    .option("-f, --filter <json>", "JSON query filter")
    .option("-s, --sort <field>", "Sort field (prefix with - for descending)")
    .option("-l, --limit <n>", "Max records to return", "50")
    .option("--skip <n>", "Number of records to skip")
    .option("--fields <fields>", "Comma-separated fields to return")
    .action(async (entityName: string, options: ListRecordsCommandOptions) => {
      await runCommand(
        () => listRecordsAction(entityName, options),
        { requireAuth: true },
        context,
      );
    });
}
