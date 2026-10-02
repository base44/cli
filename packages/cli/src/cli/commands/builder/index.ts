import { Command } from "commander";
import { getModelCommand } from "@/cli/commands/builder/model.js";
import { getNewCommand } from "@/cli/commands/builder/new.js";
import { getSendCommand } from "@/cli/commands/builder/send.js";
import { getStatusCommand } from "@/cli/commands/builder/status.js";
import { getStopCommand } from "@/cli/commands/builder/stop.js";

export function getBuilderCommand(): Command {
  return new Command("builder")
    .description(
      "Build an app with the Base44 builder agent, non-interactively: create it, send turns, read status, stop, pick the model",
    )
    .addCommand(getNewCommand())
    .addCommand(getSendCommand())
    .addCommand(getStatusCommand())
    .addCommand(getStopCommand())
    .addCommand(getModelCommand());
}
