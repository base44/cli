import type { SeedSummary } from "@/core/resources/seed/index.js";
import { runSeedScript } from "@/core/seed-script/index.js";

export interface SeedScriptStepOptions {
  appId: string;
  /** Base URL of the listening dev server the script runs against. */
  baseUrl: string;
}

/**
 * Run the project's `base44/seed.ts` after fixture application and record
 * the outcome on the summary. Never throws: the summary keeps the fixture
 * results, `script.ran` reports the outcome, and a warning carries the
 * failure reason — callers decide whether a failure is fatal (`dev seed`
 * exits non-zero) or not (startup keeps serving).
 */
export async function runSeedScriptStep(
  summary: SeedSummary,
  scriptPath: string | null,
  { appId, baseUrl }: SeedScriptStepOptions,
): Promise<void> {
  if (!scriptPath) {
    return;
  }
  try {
    const { exitCode } = await runSeedScript({
      appId,
      scriptPath,
      localUrl: baseUrl,
    });
    if (exitCode === 0) {
      summary.script = { ran: true };
      return;
    }
    summary.script = { ran: false };
    summary.warnings.push(
      `Seed script ${scriptPath} exited with code ${exitCode}`,
    );
  } catch (error) {
    summary.script = { ran: false };
    const message = error instanceof Error ? error.message : String(error);
    summary.warnings.push(`Seed script failed: ${message}`);
  }
}
