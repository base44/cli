import { log } from "@clack/prompts";
import type { UpgradeInfo } from "@/core/utils/version-check.js";
import { checkForUpgrade } from "@/core/utils/version-check.js";
import { theme } from "@/cli/utils/theme.js";

function formatUpgradeMessage(info: UpgradeInfo): string {
  const { shinyOrange } = theme.colors;
  const { bold } = theme.styles;

  return `${shinyOrange("Update available!")} ${shinyOrange(`${info.currentVersion} → ${info.latestVersion}`)}  ${shinyOrange("Run:")} ${bold(shinyOrange("npm update -g base44"))}`;
}

/**
 * Checks for available upgrades and prints a notification if one exists.
 */
export async function printUpgradeNotificationIfAvailable(): Promise<void> {
  try {
    const upgradeInfo = await checkForUpgrade();
    if (upgradeInfo) {
      log.message(formatUpgradeMessage(upgradeInfo));
    }
  } catch {
    // Silently ignore errors
  }
}
