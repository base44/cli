import { box } from "@clack/prompts";
import { theme } from "@/cli/utils/theme.js";
import type { UpgradeInfo } from "@/cli/utils/version-check.js";
import { checkForUpgrade } from "@/cli/utils/version-check.js";

const UPGRADE_COMMAND = "npm install -g base44@latest";

export function startUpgradeCheck(): Promise<UpgradeInfo | null> {
  return checkForUpgrade().catch(() => null);
}

function formatUpgradeMessage(info: UpgradeInfo): string {
  const { shinyOrange } = theme.colors;
  const { bold } = theme.styles;

  return shinyOrange(
    `Update available! ${info.currentVersion} → ${bold(info.latestVersion)}  Run: ${bold(UPGRADE_COMMAND)}`,
  );
}

export async function printUpgradeNotification(
  upgradeCheckPromise: Promise<UpgradeInfo | null>,
): Promise<void> {
  try {
    const upgradeInfo = await upgradeCheckPromise;
    if (upgradeInfo) {
      box(formatUpgradeMessage(upgradeInfo));
    }
  } catch {}
}
