import { Command } from "commander";
import { getAgentSkillsPullCommand } from "./pull.js";
import { getAgentSkillsPushCommand } from "./push.js";

export function getAgentSkillsCommand(): Command {
  return new Command("agent-skills")
    .description("Manage project agent skills")
    .addCommand(getAgentSkillsPushCommand())
    .addCommand(getAgentSkillsPullCommand());
}
