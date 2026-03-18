import { Command } from "commander";
import { getAgentsPullCommand } from "./pull.js";
import { getAgentsPushCommand } from "./push.js";

export function getAgentsCommand(): Command {
  return new Command("agents")
    .description("Manage project agents")
    .addCommand(getAgentsPushCommand())
    .addCommand(getAgentsPullCommand());
}
