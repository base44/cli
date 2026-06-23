import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { getAppContext } from "@/core/project/index.js";
import { readFile } from "@/core/resources/sandbox/api.js";
import { parsePositiveInt, toJsonStdout } from "./shared.js";

interface ReadFileOptions {
  offset?: string;
  limit?: string;
}

async function readFileAction(
  { runTask }: CLIContext,
  paths: string[],
  options: ReadFileOptions,
): Promise<RunCommandResult> {
  const { id: appId } = getAppContext();
  const offset = parsePositiveInt(options.offset, "--offset");
  const limit = parsePositiveInt(options.limit, "--limit");

  const result = await runTask("Reading file", () =>
    readFile(appId, { paths, offset, limit }),
  );

  return { outroMessage: "Read file", stdout: toJsonStdout(result) };
}

export function getSandboxReadFileCommand(): Command {
  return new Base44Command("read")
    .description("Read file contents from an app's remote sandbox")
    .argument("<paths...>", "One or more file paths relative to the app root")
    .option("--offset <n>", "1-based start line")
    .option("--limit <n>", "Max lines to return from offset")
    .action(readFileAction);
}
