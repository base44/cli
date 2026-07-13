import { Command } from "commander";
import { getWorkspaceListCommand } from "./list.js";
import { getWorkspaceMoveCommand } from "./move.js";

export function getWorkspaceCommand(): Command {
  return new Command("workspace")
    .description("List workspaces and move apps between them")
    .addCommand(getWorkspaceListCommand())
    .addCommand(getWorkspaceMoveCommand());
}
