import { Command } from "commander";
import { getImportedChatCommand } from "@/cli/commands/imported/chat.js";
import { getImportedCreateCommand } from "@/cli/commands/imported/create.js";
import {
  getImportedCommitCommand,
  getImportedDiscardCommand,
  getImportedPrCommand,
  getImportedPreviewCommand,
  getImportedStatusCommand,
} from "@/cli/commands/imported/git.js";

export function getImportedCommand(): Command {
  return new Command("imported")
    .description(
      "Work with imported apps: your own repo (or a blank one) with a Base44 agent and live preview over it",
    )
    .addCommand(getImportedCreateCommand())
    .addCommand(getImportedChatCommand())
    .addCommand(getImportedStatusCommand())
    .addCommand(getImportedCommitCommand())
    .addCommand(getImportedDiscardCommand())
    .addCommand(getImportedPrCommand())
    .addCommand(getImportedPreviewCommand());
}
