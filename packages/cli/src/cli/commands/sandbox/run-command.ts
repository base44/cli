import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { getAppContext } from "@/core/project/index.js";
import { runCommand } from "@/core/resources/sandbox/api.js";
import { parsePositiveInt, toJsonStdout } from "./shared.js";

interface RunCommandOptions {
  cwd?: string;
  timeoutMs?: string;
}

async function runCommandAction(
  { runTask }: CLIContext,
  commandParts: string[],
  options: RunCommandOptions,
): Promise<RunCommandResult> {
  const { id: appId } = getAppContext();
  const timeoutMs = parsePositiveInt(options.timeoutMs, "--timeout-ms");
  const command = commandParts.join(" ");

  const result = await runTask("Running command", () =>
    runCommand(appId, { command, cwd: options.cwd, timeout_ms: timeoutMs }),
  );

  // The HTTP call succeeded, so the CLI exits 0 regardless of the remote
  // command's exit code — that code is reported in the JSON output.
  return { outroMessage: "Ran command", stdout: toJsonStdout(result) };
}

export function getSandboxRunCommandCommand(): Command {
  return new Base44Command("run")
    .description("Run a shell command in an app's remote sandbox")
    .argument("<command...>", "Shell command to execute (quote to keep as one)")
    .option("--cwd <path>", "Working directory relative to the app root")
    .option(
      "--timeout-ms <n>",
      "Timeout in milliseconds (default 120000, max 600000)",
    )
    .addHelpText(
      "after",
      `
Examples:
  $ base44 sandbox run "npm test"
  $ base44 sandbox run ls -la --cwd src`,
    )
    .action(runCommandAction);
}
