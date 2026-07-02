import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger } from "@base44-cli/logger";
import { getTelemetryNoticePath } from "@/core/config.js";
import { isTelemetryEnabled } from "./posthog.js";

const NOTICE =
  "The Base44 CLI sends error reports (command name, CLI version, OS info, " +
  "and your account email when logged in) to help improve the CLI. " +
  "Set BASE44_DISABLE_TELEMETRY=1 to opt out.";

/**
 * Print a one-time notice that error telemetry is collected and how to opt
 * out. A marker file in the Base44 global dir records that the notice was
 * shown. Never throws — telemetry UX must not break the CLI.
 */
export function maybeShowTelemetryNotice(log: Logger): void {
  if (!isTelemetryEnabled()) {
    return;
  }

  try {
    const markerPath = getTelemetryNoticePath();
    if (existsSync(markerPath)) {
      return;
    }
    mkdirSync(dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, `${new Date().toISOString()}\n`);
    log.message(NOTICE);
  } catch {
    // Best-effort: if the marker can't be written, skip the notice rather
    // than printing it on every run or crashing the CLI.
  }
}
