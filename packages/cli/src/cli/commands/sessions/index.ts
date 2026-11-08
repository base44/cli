import { Command } from "commander";
import { getSessionsImportCommand } from "./import.js";

export function getSessionsCommand(): Command {
  return new Command("sessions")
    .description("Move Claude Code and Codex sessions to Base Code")
    .addCommand(getSessionsImportCommand());
}
