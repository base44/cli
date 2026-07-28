import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, confirmPush } from "@/cli/utils/index.js";
import { readProjectConfig } from "@/core/index.js";
import { pushAgentSkills } from "@/core/resources/agent-skill/index.js";

interface PushOptions {
  yes?: boolean;
}

async function pushAction(
  { isNonInteractive, log, runTask }: CLIContext,
  options: PushOptions,
): Promise<RunCommandResult> {
  const { agentSkills } = await readProjectConfig();

  log.info(
    agentSkills.length === 0
      ? "No local agent skills found - this will delete all remote skills"
      : `Found ${agentSkills.length} agent skills to push`,
  );

  const proceed = await confirmPush({
    isNonInteractive,
    yes: options.yes,
    log,
    warning:
      "This will replace all remote agent skills with your local skills and delete any not present locally.",
  });
  if (!proceed) {
    return { outroMessage: "Push cancelled" };
  }

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
    .option("-y, --yes", "Skip confirmation prompt")
    .action(pushAction);
}
