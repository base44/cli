import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { getAppContext } from "@/core/project/index.js";
import { createCheckpoint } from "@/core/resources/sandbox/api.js";
import { toJsonStdout } from "./shared.js";

interface CheckpointOptions {
  name?: string;
}

async function checkpointAction(
  { runTask }: CLIContext,
  options: CheckpointOptions,
): Promise<RunCommandResult> {
  const { id: appId } = getAppContext();

  const result = await runTask("Creating checkpoint", () =>
    createCheckpoint(appId, { name: options.name }),
  );

  return { outroMessage: "Created checkpoint", stdout: toJsonStdout(result) };
}

export function getSandboxCheckpointCommand(): Command {
  return new Base44Command("checkpoint")
    .description("Create a restore-point checkpoint of an app's remote sandbox")
    .option(
      "--name <name>",
      "Optional message/title for the checkpoint (defaults to an auto-generated title)",
    )
    .addHelpText(
      "after",
      `
Examples:
  $ base44 sandbox checkpoint
  $ base44 sandbox checkpoint --name "before refactor"`,
    )
    .action(checkpointAction);
}
