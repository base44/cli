import type { Logger } from "@base44-cli/logger";
import { theme } from "@/cli/utils/theme.js";
import type { SingleFunctionDeployResult } from "@/core/resources/function/deploy.js";

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatDeployResult(
  result: SingleFunctionDeployResult,
  log: Logger,
): void {
  const label = result.name.padEnd(25);
  if (result.status === "deployed") {
    const timing = result.durationMs
      ? theme.styles.dim(` (${formatDuration(result.durationMs)})`)
      : "";
    log.success(`${label} deployed${timing}`);
  } else if (result.status === "unchanged") {
    log.success(`${label} unchanged`);
  } else {
    log.error(`${label} error: ${result.error}`);
  }
}
