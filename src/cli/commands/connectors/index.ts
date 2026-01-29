import { Command } from "commander";
import { connectorsPushCommand } from "./push.js";

export const connectorsCommand = new Command("connectors")
  .description("Manage OAuth connectors")
  .addCommand(connectorsPushCommand);
