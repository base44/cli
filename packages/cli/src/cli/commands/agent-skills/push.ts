import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { readProjectConfig } from "@/core/index.js";
import { pushAgentSkills } from "@/core/resources/agent-skill/index.js";

async function pushAction({
  log,
  runTask,
}: CLIContext): Promise<RunCommandResult> {
  const { agentSkills } = await readProjectConfig();

  log.info(
    agentSkills.length === 0
      ? "No local agent skills found - this will delete all remote skills"
      : `Found ${agentSkills.length} agent skills to push`,
  );

  const result = await runTask(
    "Pushing agent skills to Base44",
    () => pushAgentSkills(agentSkills),
    {
      successMessage: "Agent skills pushed successfully",
      errorMessage: "Failed to push agent skills",
    },
  );

  if (result.created.length > 0)
    log.success(`Created: ${result.created.join(", ")}`);
  if (result.updated.length > 0)
    log.success(`Updated: ${result.updated.join(", ")}`);
  if (result.deleted.length > 0)
    log.warn(`Deleted: ${result.deleted.join(", ")}`);

  return { outroMessage: "Agent skills pushed to Base44" };
}

export function getAgentSkillsPushCommand(): Command {
  return new Base44Command("push")
    .description(
      "Push local agent skills to Base44 (replaces all remote agent skills)",
    )
    .action(pushAction);
}
