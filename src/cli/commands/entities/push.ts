import { Command } from "commander";
import { log } from "@clack/prompts";
import { pushEntities } from "@/core/resources/entity/index.js";
import { readProjectConfig } from "@/core/index.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

async function pushEntitiesAction(): Promise<RunCommandResult> {
  const { entities } = await readProjectConfig();

  if (entities.length === 0) {
    return { outroMessage: "No entities found in project" };
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

  // Print the results
  if (result.created.length > 0) {
    log.success(`Created: ${result.created.join(", ")}`);
  }
  if (result.updated.length > 0) {
    log.success(`Updated: ${result.updated.join(", ")}`);
  }
  if (result.deleted.length > 0) {
    log.warn(`Deleted: ${result.deleted.join(", ")}`);
  }

  return {};
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
