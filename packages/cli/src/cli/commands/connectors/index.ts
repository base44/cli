import { Command } from "commander";
import { getConnectorsListAvailableCommand } from "./list-available.js";
import { getConnectorsPullCommand } from "./pull.js";
import { getConnectorsPushCommand } from "./push.js";

export function getConnectorsCommand(): Command {
  return new Command("connectors")
    .description("Manage project connectors (OAuth integrations)")
    .addCommand(getConnectorsListAvailableCommand())
    .addCommand(getConnectorsPullCommand())
    .addCommand(getConnectorsPushCommand());
}
