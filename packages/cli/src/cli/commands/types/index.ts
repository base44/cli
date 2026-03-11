import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { getTypesGenerateCommand } from "./generate.js";

export function getTypesCommand(context: CLIContext): Command {
  return new Command("types")
    .description("Manage TypeScript type generation")
    .addCommand(getTypesGenerateCommand(context));
}
