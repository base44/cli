import { dirname, join } from "node:path";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { readProjectConfig } from "@/core/index.js";
import {
  fetchAgentSkills,
  writeAgentSkills,
} from "@/core/resources/agent-skill/index.js";

async function pullAction({
  log,
  runTask,
}: CLIContext): Promise<RunCommandResult> {
  const { project } = await readProjectConfig();
  const dir = join(dirname(project.configPath), project.agentSkillsDir);

  const remote = await runTask(
    "Fetching agent skills from Base44",
    () => fetchAgentSkills(),
    {
      successMessage: "Agent skills fetched successfully",
      errorMessage: "Failed to fetch agent skills",
    },
  );

  const { written, deleted } = await runTask(
    "Syncing skill files",
    () => writeAgentSkills(dir, remote.items),
    {
      successMessage: "Skill files synced successfully",
      errorMessage: "Failed to sync skill files",
    },
  );

  if (written.length > 0) log.success(`Written: ${written.join(", ")}`);
  if (deleted.length > 0) log.warn(`Deleted: ${deleted.join(", ")}`);
  if (written.length === 0 && deleted.length === 0)
    log.info("All skills are already up to date");

  return { outroMessage: `Pulled ${remote.total} agent skills to ${dir}` };
}

export function getAgentSkillsPullCommand(): Command {
  return new Base44Command("pull")
    .description(
      "Pull agent skills from Base44 to local files (replaces all local agent skills)",
    )
    .action(pullAction);
}
