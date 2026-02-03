import { log } from "@clack/prompts";
import { theme } from "@/cli/utils/theme.js";
import type { UpgradeInfo } from "@/cli/utils/version-check.js";
import { checkForUpgrade } from "@/cli/utils/version-check.js";

function formatUpgradeMessage(info: UpgradeInfo): string {
  const { shinyOrange } = theme.colors;
  const { bold } = theme.styles;

  return `${shinyOrange("Update available!")} ${shinyOrange(`${info.currentVersion} → ${info.latestVersion}`)}  ${shinyOrange("Run:")} ${bold(shinyOrange("npm update -g base44"))}`;
}

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
