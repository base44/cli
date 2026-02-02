import type { CLIContext } from "@/cli/types.js";
import { Command } from "commander";
import { getAgentsPullCommand } from "./pull.js";
import { getAgentsPushCommand } from "./push.js";

export function getAgentsCommand(context: CLIContext): Command {
  return new Command("agents")
    .description("Manage project agents")
    .addCommand(getAgentsPushCommand(context))
    .addCommand(getAgentsPullCommand(context));
}
