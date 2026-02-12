import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { getConnectorsPushCommand } from "./push.js";

export function getConnectorsCommand(context: CLIContext): Command {
  return new Command("connectors")
    .description("Manage project connectors (OAuth integrations)")
    .addCommand(getConnectorsPushCommand(context));
}
