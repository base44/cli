import type { Logger } from "@base44-cli/logger";
import type { McpConfigState } from "@/core/resources/mcp/index.js";

/** A tool's name when the platform gave one; the item shape is the platform's. */
function toolLabel(tool: unknown): string | undefined {
  if (typeof tool === "string") {
    return tool;
  }
  if (tool && typeof tool === "object" && "name" in tool) {
    return typeof tool.name === "string" ? tool.name : undefined;
  }
  return undefined;
}

function describeTools(tools: unknown[]): string {
  const names = tools.map(toolLabel).filter((name) => name !== undefined);
  return names.length === tools.length && names.length > 0
    ? `: ${names.join(", ")}`
    : "";
}

/** Prints the surface the platform resolved for the config. */
export function printMcpSurface(state: McpConfigState, log: Logger): void {
  const { tools, pendingRemoval } = state;
  log.info(
    `${tools.length} ${tools.length === 1 ? "tool" : "tools"} exposed${describeTools(tools)}`,
  );
  if (pendingRemoval.length > 0) {
    log.warn(
      `${pendingRemoval.length} pending removal${describeTools(pendingRemoval)}`,
    );
  }
}
