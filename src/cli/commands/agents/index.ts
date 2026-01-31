import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { getAgentsPushCommand } from "./push.js";
import { getAgentsPullCommand } from "./pull.js";

export function getAgentsCommand(context: CLIContext): Command {
  return new Command("agents")
    .description("Manage project agents")
    .addCommand(getAgentsPushCommand(context))
    .addCommand(getAgentsPullCommand(context));
}
