import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { getSiteDeployCommand } from "./deploy.js";
import { getSiteBrowseCommand } from "./browse.js";

export function getSiteCommand(context: CLIContext): Command {
  return new Command("site")
    .description("Manage site")
    .addCommand(getSiteDeployCommand(context))
    .addCommand(getSiteBrowseCommand(context));
}
