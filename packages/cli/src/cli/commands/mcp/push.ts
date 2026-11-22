import { dirname, join } from "node:path";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { readProjectConfig } from "@/core/project/index.js";
import {
  getMcpConfigPath,
  MCP_DIR,
  mcpConfigNotes,
  pushMcpConfig,
} from "@/core/resources/mcp/index.js";
import { printMcpSurface } from "./format.js";

async function pushMcpAction({
  log,
  runTask,
  jsonMode,
}: CLIContext): Promise<RunCommandResult> {
  const { project, mcpConfig } = await readProjectConfig();
  const config = mcpConfig[0];

  // No file is not a takedown: removing the server is `mcp delete`.
  if (!config) {
    const path = getMcpConfigPath(join(dirname(project.configPath), MCP_DIR));
    return {
      outroMessage: `No MCP config found at ${path} - nothing to push`,
    };
  }

  const state = await runTask(
    "Pushing MCP config to Base44",
    async () => {
      return await pushMcpConfig(config);
    },
    {
      successMessage: "MCP config pushed successfully",
      errorMessage: "Failed to push MCP config",
    },
  );

  const notes = mcpConfigNotes(config);
  const outroMessage = "MCP config is live on Base44";

  if (jsonMode) {
    return {
      outroMessage,
      stdout: `${JSON.stringify({ ...state, notes }, null, 2)}\n`,
    };
  }

  if (state) {
    printMcpSurface(state, log);
  }
  for (const note of notes) {
    log.info(note);
  }
  return { outroMessage };
}

export function getMcpPushCommand(): Command {
  return new Base44Command("push")
    .description(
      "Push the local MCP config (base44/mcp/config.json) to Base44; it is live immediately",
    )
    .action(pushMcpAction);
}
