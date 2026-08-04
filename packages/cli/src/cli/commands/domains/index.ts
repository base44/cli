import { Command } from "commander";
import { getDomainsAddCommand } from "./add.js";
import { getDomainsListCommand } from "./list.js";
import { getDomainsRemoveCommand } from "./remove.js";

export function getDomainsCommand(): Command {
  return new Command("domains")
    .description("Manage custom domains for full-stack apps")
    .addCommand(getDomainsAddCommand())
    .addCommand(getDomainsListCommand())
    .addCommand(getDomainsRemoveCommand());
}
