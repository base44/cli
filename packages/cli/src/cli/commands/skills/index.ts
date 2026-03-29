import { Command } from "commander";
import { getSkillsUpdateCommand } from "@/cli/commands/skills/update.js";

export function getAgentSkillsCommand(): Command {
  return new Command("agent-skills")
    .description("Manage locally installed agent skills")
    .addCommand(getSkillsUpdateCommand());
}
