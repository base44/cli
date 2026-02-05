import { Command } from "commander";
import { log } from "@clack/prompts";
import type { CLIContext } from "@/cli/types.js";
import type { Base44LocalProjectSDK } from "@/core/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

async function pullAgentsAction(sdk: Base44LocalProjectSDK): Promise<RunCommandResult> {
  const { written, deleted } = await runTask(
    "Pulling agents from Base44",
    async () => {
      return await sdk.agents.pull();
    },
    {
      successMessage: "Agents pulled successfully",
      errorMessage: "Failed to pull agents",
    }
  );

  if (written.length === 0 && deleted.length === 0) {
    return { outroMessage: "No agents found on Base44" };
  }

  if (written.length > 0) {
    log.success(`Written: ${written.join(", ")}`);
  }
  if (deleted.length > 0) {
    log.warn(`Deleted: ${deleted.join(", ")}`);
  }

  return { outroMessage: `Pulled ${written.length} agents from Base44` };
}

export function getAgentsPullCommand(context: CLIContext): Command {
  return new Command("pull")
    .description(
      "Pull agents from Base44 to local files (replaces all local agent configs)"
    )
    .action(async () => {
      await runCommand(pullAgentsAction, { requireAuth: true }, context);
    });
}
