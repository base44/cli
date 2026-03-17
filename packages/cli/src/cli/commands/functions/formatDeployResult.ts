import type { Logger } from "@/cli/utils/logger/types.js";
import { theme } from "@/cli/utils/theme.js";
import type { SingleFunctionDeployResult } from "@/core/resources/function/deploy.js";

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatDeployResult(
  result: SingleFunctionDeployResult,
  logger: Logger,
): void {
  const label = result.name.padEnd(25);
  if (result.status === "deployed") {
    const timing = result.durationMs
      ? theme.styles.dim(` (${formatDuration(result.durationMs)})`)
      : "";
    logger.success(`${label} deployed${timing}`);
  } else if (result.status === "unchanged") {
    logger.success(`${label} unchanged`);
  } else {
    logger.error(`${label} error: ${result.error}`);
  }
}
