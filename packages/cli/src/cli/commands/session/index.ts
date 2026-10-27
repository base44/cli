import { Command } from "commander";
import { getSessionImportCommand } from "./import.js";

export function getSessionCommand(): Command {
  return new Command("session")
    .description("Move local coding-agent sessions into Base44 (experimental)")
    .addCommand(getSessionImportCommand());
}
