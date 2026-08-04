import { Command } from "commander";
import { getSiteDeployCommand } from "./deploy.js";
import { getSiteOpenCommand } from "./open.js";

export function getSiteCommand(): Command {
  return new Command("site")
    .description("Manage app site (frontend app)")
    .addCommand(getSiteDeployCommand())
    .addCommand(getSiteOpenCommand());
}
