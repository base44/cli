import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { getAppContext } from "@/core/project/index.js";
import { grep } from "@/core/resources/sandbox/api.js";
import { parsePositiveInt, toJsonStdout } from "./shared.js";

interface GrepOptions {
  path?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  glob?: string;
  maxResults?: string;
}

async function grepAction(
  { runTask }: CLIContext,
  pattern: string,
  options: GrepOptions,
): Promise<RunCommandResult> {
  const { id: appId } = getAppContext();
  const maxResults = parsePositiveInt(options.maxResults, "--max-results");

  const result = await runTask("Searching files", () =>
    grep(appId, {
      pattern,
      path: options.path,
      is_regex: options.regex,
      case_sensitive: options.caseSensitive,
      glob: options.glob,
      max_results: maxResults,
    }),
  );

  return { outroMessage: "Searched files", stdout: toJsonStdout(result) };
}

export function getSandboxGrepCommand(): Command {
  return new Base44Command("grep")
    .description("Search files for a pattern in an app's remote sandbox")
    .argument("<pattern>", "Search pattern")
    .option("--path <path>", "Subtree to search, relative to the app root")
    .option("--no-regex", "Treat the pattern as a literal string, not a regex")
    .option("--case-sensitive", "Case-sensitive match")
    .option("--glob <glob>", 'File glob filter, e.g. "*.tsx"')
    .option("--max-results <n>", "Maximum number of match lines to return")
    .action(grepAction);
}
