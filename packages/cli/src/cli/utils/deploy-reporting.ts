import type { Logger } from "@base44-cli/logger";
import { theme } from "@/cli/utils/theme.js";
import type { SingleDeployResult } from "@/core/resources/types.js";

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatDeployResult(
  result: SingleDeployResult,
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

export function buildDeploySummary(
  results: SingleDeployResult[],
  noun: "functions" | "actors",
): string {
  const deployed = results.filter((r) => r.status === "deployed").length;
  const unchanged = results.filter((r) => r.status === "unchanged").length;
  const failed = results.filter((r) => r.status === "error").length;

  const parts: string[] = [];
  if (deployed > 0) parts.push(`${deployed} deployed`);
  if (unchanged > 0) parts.push(`${unchanged} unchanged`);
  if (failed > 0) parts.push(`${failed} error${failed !== 1 ? "s" : ""}`);
  return parts.join(", ") || `No ${noun} deployed`;
}
