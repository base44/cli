import { Command } from "commander";
import { getSecretsDeleteCommand } from "./delete.js";
import { getSecretsListCommand } from "./list.js";
import { getSecretsSetCommand } from "./set.js";

export function getSecretsCommand(): Command {
  return new Command("secrets")
    .description("Manage project secrets (environment variables)")
    .addCommand(getSecretsListCommand())
    .addCommand(getSecretsSetCommand())
    .addCommand(getSecretsDeleteCommand());
}
