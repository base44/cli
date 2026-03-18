import { Command } from "commander";
import { getTypesGenerateCommand } from "./generate.js";

export function getTypesCommand(): Command {
  return new Command("types")
    .description("Manage TypeScript type generation")
    .addCommand(getTypesGenerateCommand());
}
