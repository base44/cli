import { Command } from "commander";
import { getDataDumpCommand } from "./dump.js";
import { getDataPullCommand } from "./pull.js";

export function getDataCommand(): Command {
  return new Command("data")
    .description("Move data between the remote app, local dev, and fixtures")
    .addCommand(getDataPullCommand())
    .addCommand(getDataDumpCommand());
}
