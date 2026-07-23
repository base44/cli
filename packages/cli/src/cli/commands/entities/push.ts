import { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, confirmPush } from "@/cli/utils/index.js";
import { readProjectConfig } from "@/core/index.js";
import { pushEntities } from "@/core/resources/entity/index.js";

interface PushOptions {
  yes?: boolean;
}

async function pushEntitiesAction(
  { isNonInteractive, log, runTask }: CLIContext,
  options: PushOptions,
): Promise<RunCommandResult> {
  const { entities } = await readProjectConfig();

  if (entities.length === 0) {
    return { outroMessage: "No entities found in project" };
  }

  const entityNames = entities.map((e) => e.name).join(", ");
  log.info(`Found ${entities.length} entities to push: ${entityNames}`);

  const proceed = await confirmPush({
    isNonInteractive,
    yes: options.yes,
    log,
    warning:
      "This will overwrite your app's entities with your local copy and delete any not present locally.",
  });
  if (!proceed) {
    return { outroMessage: "Push cancelled" };
  }

  const result = await runTask(
    "Pushing entities to Base44",
    async () => {
      return await pushEntities(entities);
    },
    {
      successMessage: "Entities pushed successfully",
      errorMessage: "Failed to push entities",
    },
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

  return { outroMessage: "Entities pushed to Base44" };
}

export function getEntitiesPushCommand(): Command {
  return new Command("entities")
    .description("Manage project entities")
    .addCommand(
      new Base44Command("push")
        .description("Push local entities to Base44")
        .option("-y, --yes", "Skip confirmation prompt")
        .action(pushEntitiesAction),
    );
}
