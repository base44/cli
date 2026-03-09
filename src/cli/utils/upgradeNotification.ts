import { box } from "@clack/prompts";
import { theme } from "@/cli/utils/theme.js";
import type { UpgradeInfo } from "@/cli/utils/version-check.js";
import { checkForUpgrade } from "@/cli/utils/version-check.js";

const UPGRADE_COMMAND = "npm install -g base44@latest";

/**
 * Starts the upgrade check in the background. Returns a promise that
 * resolves to upgrade info (or null). Never rejects.
 */
export function startUpgradeCheck(): Promise<UpgradeInfo | null> {
  return checkForUpgrade().catch(() => null);
}

/**
 * Awaits the upgrade check and prints a bordered notification if an
 * upgrade is available. Should be called just before `outro()`.
 */
export async function printUpgradeNotification(
  upgradeCheckPromise: Promise<UpgradeInfo | null>,
): Promise<void> {
  try {
    const upgradeInfo = await upgradeCheckPromise;
    if (upgradeInfo) {
      const { shinyOrange } = theme.colors;
      const { bold } = theme.styles;

      const message = [
        shinyOrange(
          `Update available! ${upgradeInfo.currentVersion} → ${bold(upgradeInfo.latestVersion)}`,
        ),
        shinyOrange(`Run: ${bold(UPGRADE_COMMAND)}`),
        "",
        "[Agent Hints]",
        `  Run: ${UPGRADE_COMMAND}`,
      ].join("\n");

      box(message);
    }
  } catch {
    // Silently ignore errors
  }
}
