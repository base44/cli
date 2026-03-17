import { note } from "@clack/prompts";
import type { Distribution } from "@/cli/types.js";
import { theme } from "@/cli/utils/theme.js";
import type { UpgradeInfo } from "@/cli/utils/version-check.js";
import { checkForUpgrade } from "@/cli/utils/version-check.js";

type InstallMethod = "npm" | "brew" | "binary";

function detectInstallMethod(distribution: Distribution): InstallMethod {
  if (distribution !== "binary") {
    return "npm";
  }
  const execPath = process.execPath.toLowerCase();
  if (execPath.includes("/homebrew/") || execPath.includes("/cellar/")) {
    return "brew";
  }
  return "binary";
}

function getUpgradeInstruction(method: InstallMethod): string {
  switch (method) {
    case "npm":
      return "Run: npm install -g base44@latest";
    case "brew":
      return "Run: brew upgrade base44";
    case "binary":
      return "Download Base44 CLI from: https://github.com/base44/cli/releases/latest";
  }
}

export function startUpgradeCheck(): Promise<UpgradeInfo | null> {
  return checkForUpgrade().catch(() => null);
}

function formatUpgradeMessage(
  info: UpgradeInfo,
  distribution: Distribution,
): string {
  const { shinyOrange } = theme.colors;
  const { bold } = theme.styles;
  const instruction = getUpgradeInstruction(detectInstallMethod(distribution));

  return [
    shinyOrange(
      `Update available! ${info.currentVersion} → ${bold(info.latestVersion)}`,
    ),
    shinyOrange(instruction),
  ].join("\n");
}

export async function printUpgradeNotification(
  upgradeCheckPromise: Promise<UpgradeInfo | null>,
  distribution: Distribution,
): Promise<void> {
  try {
    const upgradeInfo = await upgradeCheckPromise;
    if (upgradeInfo) {
      note(formatUpgradeMessage(upgradeInfo, distribution));
    }
  } catch {}
}
