import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { getSecretsDeleteCommand } from "./delete.js";
import { getSecretsListCommand } from "./list.js";
import { getSecretsSetCommand } from "./set.js";

export function getSecretsCommand(context: CLIContext): Command {
  return new Command("secrets")
    .description("Manage project secrets (environment variables)")
    .addCommand(getSecretsListCommand(context))
    .addCommand(getSecretsSetCommand(context))
    .addCommand(getSecretsDeleteCommand(context));
}
