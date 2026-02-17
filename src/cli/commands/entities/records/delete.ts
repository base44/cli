import { confirm, log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { CLIExitError } from "@/cli/errors.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { deleteRecord } from "@/core/resources/entity/index.js";

interface DeleteRecordCommandOptions {
  yes?: boolean;
}

async function deleteRecordAction(
  entityName: string,
  recordId: string,
  options: DeleteRecordCommandOptions,
): Promise<RunCommandResult> {
  if (!options.yes) {
    const confirmed = await confirm({
      message: `Delete ${entityName} record ${recordId}?`,
    });

    if (confirmed !== true) {
      throw new CLIExitError(0);
    }
  }

  await runTask(
    `Deleting ${entityName} record...`,
    async () => {
      return await deleteRecord(entityName, recordId);
    },
    {
      successMessage: `Deleted ${entityName} record`,
      errorMessage: `Failed to delete ${entityName} record`,
    },
  );

  log.success(`Record ${recordId} deleted`);

  return {};
}

export function getRecordsDeleteCommand(context: CLIContext): Command {
  return new Command("delete")
    .description("Delete an entity record")
    .argument("<entity-name>", "Name of the entity (e.g. Users, Products)")
    .argument("<record-id>", "ID of the record to delete")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(
      async (
        entityName: string,
        recordId: string,
        options: DeleteRecordCommandOptions,
      ) => {
        await runCommand(
          () => deleteRecordAction(entityName, recordId, options),
          { requireAuth: true },
          context,
        );
      },
    );
}
