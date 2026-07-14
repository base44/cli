import { Command } from "commander";
import { getWorkspaceGetCommand } from "./get.js";
import { getWorkspaceListCommand } from "./list.js";
import { getWorkspaceMoveCommand } from "./move.js";

export function getWorkspaceCommand(): Command {
  return new Command("workspace")
    .description("List workspaces, inspect one, and move apps between them")
    .addCommand(getWorkspaceListCommand())
    .addCommand(getWorkspaceGetCommand())
    .addCommand(getWorkspaceMoveCommand());
}
