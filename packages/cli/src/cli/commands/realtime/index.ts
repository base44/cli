import { Command } from "commander";
import { getDeployCommand } from "./deploy.js";
import { getNewCommand } from "./new.js";

export function getRealtimeCommand(): Command {
  return new Command("realtime")
    .description("Manage realtime handlers")
    .addCommand(getNewCommand())
    .addCommand(getDeployCommand());
}
