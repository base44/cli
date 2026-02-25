import { log } from "@clack/prompts";
import { theme } from "@/cli/utils/theme.js";
import type { SingleFunctionDeployResult } from "@/core/resources/function/deploy.js";

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatDeployResult(r: SingleFunctionDeployResult): void {
  const label = r.name.padEnd(25);
  if (r.status === "deployed") {
    const timing = r.duration_ms
      ? theme.styles.dim(` (${formatDuration(r.duration_ms)})`)
      : "";
    log.success(`${label} deployed${timing}`);
  } else if (r.status === "unchanged") {
    log.success(`${label} unchanged`);
  } else {
    log.error(`${label} error: ${r.error}`);
  }
}
