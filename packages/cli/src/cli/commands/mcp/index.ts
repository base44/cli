import { Command } from "commander";
import { getMcpDeleteCommand } from "./delete.js";
import { getMcpPullCommand } from "./pull.js";
import { getMcpPushCommand } from "./push.js";

export function getMcpCommand(): Command {
  return new Command("mcp")
    .description("Manage the app's MCP server config (base44/mcp/config.json)")
    .addCommand(getMcpPushCommand())
    .addCommand(getMcpPullCommand())
    .addCommand(getMcpDeleteCommand());
}
