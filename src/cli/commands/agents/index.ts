import { Command } from "commander";
import { agentsPushCommand } from "./push.js";
import { agentsPullCommand } from "./pull.js";

export const agentsCommand = new Command("agents")
  .description("Manage project agents")
  .addCommand(agentsPushCommand)
  .addCommand(agentsPullCommand);
