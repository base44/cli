import { Command } from "commander";
import { getSandboxCheckpointCommand } from "./checkpoint.js";
import { getSandboxEditFileCommand } from "./edit-file.js";
import { getSandboxGrepCommand } from "./grep.js";
import { getSandboxListDirectoryCommand } from "./list-directory.js";
import { getSandboxReadFileCommand } from "./read-file.js";
import { getSandboxRunCommandCommand } from "./run-command.js";
import { getSandboxWriteFileCommand } from "./write-file.js";

export function getSandboxCommand(): Command {
  return new Command("sandbox")
    .description("Develop an app remotely via its server-side sandbox")
    .addCommand(getSandboxListDirectoryCommand())
    .addCommand(getSandboxReadFileCommand())
    .addCommand(getSandboxWriteFileCommand())
    .addCommand(getSandboxEditFileCommand())
    .addCommand(getSandboxGrepCommand())
    .addCommand(getSandboxRunCommandCommand())
    .addCommand(getSandboxCheckpointCommand());
}
