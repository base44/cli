import { Command } from "commander";
import { pushEntities } from "@core/resources/entity/index.js";
import { readProjectConfig } from "@core/index.js";
import { runCommand, runTask, log } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

/**
 * JSON output result for the entities push command.
 */
interface EntitiesPushResult {
  /** Names of entities that were newly created. */
  created: string[];
  /** Names of entities that were updated. */
  updated: string[];
  /** Names of entities that were deleted. */
  deleted: string[];
}

async function pushEntitiesAction(): Promise<RunCommandResult<EntitiesPushResult>> {
  const { entities } = await readProjectConfig();

  if (entities.length === 0) {
    return {
      outroMessage: "No entities found in project",
      data: { created: [], updated: [], deleted: [] },
    };
  }

  log.info(`Found ${entities.length} entities to push`);

  const result = await runTask(
    "Pushing entities to Base44",
    async () => {
      return await pushEntities(entities);
    },
    {
      successMessage: "Entities pushed successfully",
      errorMessage: "Failed to push entities",
    }
  );

  if (result.created.length > 0) {
    log.success(`Created: ${result.created.join(", ")}`);
  }
  if (result.updated.length > 0) {
    log.success(`Updated: ${result.updated.join(", ")}`);
  }
  if (result.deleted.length > 0) {
    log.warn(`Deleted: ${result.deleted.join(", ")}`);
  }

  return {
    data: {
      created: result.created,
      updated: result.updated,
      deleted: result.deleted,
    },
  };
}

export const entitiesPushCommand = new Command("entities")
  .description("Manage project entities")
  .addCommand(
    new Command("push")
      .description("Push local entities to Base44")
      .action(async () => {
        await runCommand(pushEntitiesAction, { requireAuth: true });
      })
  );
