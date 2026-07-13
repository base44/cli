import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { getAppContext } from "@/core/project/index.js";
import { listDirectory } from "@/core/resources/sandbox/api.js";
import { parsePositiveInt, toJsonStdout } from "./shared.js";

interface ListDirectoryOptions {
  recursive?: boolean;
  maxDepth?: string;
  includeHidden?: boolean;
}

async function listDirectoryAction(
  { runTask }: CLIContext,
  path: string | undefined,
  options: ListDirectoryOptions,
): Promise<RunCommandResult> {
  const { id: appId } = getAppContext();
  const maxDepth = parsePositiveInt(options.maxDepth, "--max-depth");

  const result = await runTask("Listing directory", () =>
    listDirectory(appId, {
      path,
      recursive: options.recursive,
      max_depth: maxDepth,
      include_hidden: options.includeHidden,
    }),
  );

  return { outroMessage: "Listed directory", stdout: toJsonStdout(result) };
}

export function getSandboxListDirectoryCommand(): Command {
  return new Base44Command("ls")
    .description("List directory entries in an app's remote sandbox")
    .argument(
      "[path]",
      "Directory relative to the app root (default: app root)",
    )
    .option("--recursive", "List nested entries")
    .option("--max-depth <n>", "Max depth when recursive (1-10, default 3)")
    .option("--include-hidden", "Include dotfiles")
    .action(listDirectoryAction);
}
