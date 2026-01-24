import { Command } from "commander";
import { connectorsAddCommand } from "./add.js";
import { connectorsListCommand } from "./list.js";
import { connectorsPushCommand } from "./push.js";
import { connectorsRemoveCommand } from "./remove.js";

export const connectorsCommand = new Command("connectors")
  .description("Manage OAuth connectors")
  .addCommand(connectorsAddCommand)
  .addCommand(connectorsListCommand)
  .addCommand(connectorsPushCommand)
  .addCommand(connectorsRemoveCommand);
