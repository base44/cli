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
  { runTask, branchId }: CLIContext,
  options: CheckpointOptions,
): Promise<RunCommandResult> {
  const { id: appId } = getAppContext();

  const result = await runTask("Creating checkpoint", () =>
    createCheckpoint(appId, {
      name: options.name,
      branch_id: branchId,
    }),
  );

  return { outroMessage: "Created checkpoint", stdout: toJsonStdout(result) };
}

export function getSandboxCheckpointCommand(): Command {
  return new Base44Command("checkpoint", { supportsBranch: true })
    .description(
      "Save a restore point in the builder's version history (run after each unit of work)",
    )
    .option(
      "--name <name>",
      "Optional title, ideally a short summary of what changed (defaults to an auto-generated title)",
    )
    .addHelpText(
      "after",
      `
Sandbox writes are committed but not checkpointed. Only checkpoints appear in
the builder's version history, and a Restore or Revert there rolls the app back
to the last checkpoint and discards everything written after it. Run this when
you finish a unit of work and always before you stop, so the user can restore
your work instead of losing it. Pending changes are flushed first, so the
checkpoint captures your latest code.

Examples:
  $ base44 sandbox checkpoint
  $ base44 sandbox checkpoint --name "before refactor"`,
    )
    .action(checkpointAction);
}
