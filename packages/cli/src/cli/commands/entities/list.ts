import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask, theme } from "@/cli/utils/index.js";
import {
  type EntityRecord,
  type ListEntityRecordsOptions,
  listEntityRecords,
} from "@/core/resources/entity/data-api.js";

interface ListOptions {
  limit?: string;
  sort?: string;
  skip?: string;
}

function formatRecordRow(record: EntityRecord, fields: string[]): string {
  const values = fields.map((field) => {
    const value = record[field];
    if (value === undefined || value === null) return "-";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
  return values.join("\t");
}

function pickDisplayFields(records: EntityRecord[]): string[] {
  const systemFields = ["id", "created_date"];
  if (records.length === 0) return systemFields;

  const skipFields = new Set([
    "id",
    "created_date",
    "updated_date",
    "created_by",
    "created_by_id",
    "app_id",
    "entity_name",
    "is_deleted",
    "deleted_date",
    "environment",
    "_id",
  ]);

  const dataFields: string[] = [];
  for (const key of Object.keys(records[0])) {
    if (!skipFields.has(key) && dataFields.length < 4) {
      dataFields.push(key);
    }
  }

  return [...systemFields, ...dataFields];
}

async function listAction(
  { log }: CLIContext,
  entityName: string,
  options: ListOptions,
): Promise<RunCommandResult> {
  const apiOptions: ListEntityRecordsOptions = {};

  if (options.limit) {
    apiOptions.limit = Number.parseInt(options.limit, 10);
  } else {
    apiOptions.limit = 10;
  }

  if (options.skip) {
    apiOptions.skip = Number.parseInt(options.skip, 10);
  }

  if (options.sort) {
    apiOptions.sort = options.sort;
  }

  const records = await runTask(
    `Fetching ${entityName} records...`,
    async () => listEntityRecords(entityName, apiOptions),
    { errorMessage: `Failed to fetch ${entityName} records` },
  );

  if (records.length === 0) {
    return { outroMessage: `No records found for ${entityName}` };
  }

  const fields = pickDisplayFields(records);
  const header = fields.join("\t");

  log.message(theme.styles.dim(header));
  for (const record of records) {
    log.message(`  ${formatRecordRow(record, fields)}`);
  }

  return {
    outroMessage: `Showing ${records.length} ${entityName} record${records.length !== 1 ? "s" : ""}`,
  };
}

export function getEntitiesListCommand(): Command {
  return new Base44Command("list")
    .description("List entity records")
    .argument("<entityName>", "Name of the entity")
    .option("-n, --limit <n>", "Maximum number of records to return (default: 10)")
    .option("--sort <field>", "Field to sort by")
    .option("--skip <n>", "Number of records to skip")
    .action(listAction);
}
