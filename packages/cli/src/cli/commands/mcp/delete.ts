import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, confirmPush } from "@/cli/utils/index.js";
import { removeMcpConfig } from "@/core/resources/mcp/index.js";

interface DeleteOptions {
  yes?: boolean;
}

async function deleteMcpAction(
  { isNonInteractive, log, runTask, jsonMode }: CLIContext,
  options: DeleteOptions,
): Promise<RunCommandResult> {
  const proceed = await confirmPush({
    isNonInteractive,
    yes: options.yes,
    log,
    warning:
      "This will delete the app's MCP config on Base44 and take its MCP server down. The local file is not changed.",
  });
  if (!proceed) {
    return { outroMessage: "Delete cancelled" };
  }

  const state = await runTask(
    "Removing MCP config from Base44",
    async () => {
      return await removeMcpConfig();
    },
    {
      successMessage: "MCP config removed",
      errorMessage: "Failed to remove MCP config",
    },
  );

  const outroMessage = "The app's MCP server is down";
  if (jsonMode) {
    return {
      outroMessage,
      stdout: `${JSON.stringify(state, null, 2)}\n`,
    };
  }
  return { outroMessage };
}

export function getMcpDeleteCommand(): Command {
  return new Base44Command("delete")
    .description(
      "Delete the app's MCP config on Base44 and take its MCP server down",
    )
    .option("-y, --yes", "Skip confirmation prompt")
    .action(deleteMcpAction);
}
