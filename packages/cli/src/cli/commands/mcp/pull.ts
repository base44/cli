import { dirname, join } from "node:path";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { readProjectSettings } from "@/core/project/index.js";
import {
  getMcpConfigPath,
  MCP_DIR,
  pullMcpConfig,
  writeMcpConfig,
} from "@/core/resources/mcp/index.js";
import { printMcpSurface } from "./format.js";

async function pullMcpAction({
  log,
  runTask,
  jsonMode,
}: CLIContext): Promise<RunCommandResult> {
  // Settings only: pulling must work when the local MCP file is the broken one.
  const project = await readProjectSettings();
  const mcpDir = join(dirname(project.configPath), MCP_DIR);
  const path = getMcpConfigPath(mcpDir);

  const state = await runTask(
    "Fetching MCP config from Base44",
    async () => {
      return await pullMcpConfig();
    },
    {
      successMessage: "MCP config fetched successfully",
      errorMessage: "Failed to fetch MCP config",
    },
  );

  // No remote config leaves the local file alone: it may be a draft not yet pushed.
  const written = state.config
    ? (await writeMcpConfig(mcpDir, state.config)).written
    : false;

  const outroMessage = state.config
    ? written
      ? `Pulled MCP config to ${path}`
      : "MCP config is already up to date"
    : "This app has no MCP config on Base44 - nothing to pull";

  if (jsonMode) {
    return {
      outroMessage,
      stdout: `${JSON.stringify({ ...state, path, written }, null, 2)}\n`,
    };
  }

  if (state.config) {
    printMcpSurface(state, log);
  }
  return { outroMessage };
}

export function getMcpPullCommand(): Command {
  return new Base44Command("pull")
    .description(
      "Pull the app's MCP config from Base44 to base44/mcp/config.json",
    )
    .action(pullMcpAction);
}
