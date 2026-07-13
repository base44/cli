import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { getAppContext } from "@/core/project/index.js";
import { writeFile } from "@/core/resources/sandbox/api.js";
import { resolveFlagOrStdin, toJsonStdout } from "./shared.js";

interface WriteFileOptions {
  content?: string;
  overwrite?: boolean;
}

async function writeFileAction(
  { runTask }: CLIContext,
  path: string,
  options: WriteFileOptions,
): Promise<RunCommandResult> {
  const { id: appId } = getAppContext();
  const content = await resolveFlagOrStdin(options.content, "--content");

  const result = await runTask("Writing file", () =>
    writeFile(appId, { path, content, overwrite: options.overwrite }),
  );

  return { outroMessage: "Wrote file", stdout: toJsonStdout(result) };
}

export function getSandboxWriteFileCommand(): Command {
  return new Base44Command("write")
    .description("Create or overwrite a file in an app's remote sandbox")
    .argument("<path>", "File path relative to the app root")
    .option("--content <content>", "File content (if omitted, read from stdin)")
    .option("--overwrite", "Overwrite the file if it already exists")
    .addHelpText(
      "after",
      `
Examples:
  $ echo "hello" | base44 sandbox write notes.txt
  $ base44 sandbox write notes.txt --content "hello" --overwrite`,
    )
    .action(writeFileAction);
}
