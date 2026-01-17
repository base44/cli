import { log } from "@clack/prompts";
import { BaseCommand } from "../../lib/base-command.js";
import { runTask } from "../../lib/run-task.js";
import { pushEntities } from "../../../core/resources/entity/index.js";
import { readProjectConfig } from "../../../core/index.js";

export default class EntitiesPush extends BaseCommand {
  static override description = "Push local entities to Base44";
  static override examples = ["<%= config.bin %> entities push"];

  async run(): Promise<void> {
    const { entities } = await readProjectConfig();

    if (entities.length === 0) {
      log.warn("No entities found in project");
      return;
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

    if (
      result.created.length === 0 &&
      result.updated.length === 0 &&
      result.deleted.length === 0
    ) {
      log.info("No changes detected");
    }
  }
}
