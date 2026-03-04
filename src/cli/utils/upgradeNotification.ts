import { log } from "@clack/prompts";
import stripAnsi from "strip-ansi";
import { theme } from "@/cli/utils/theme.js";
import type { UpgradeInfo } from "@/cli/utils/version-check.js";
import { checkForUpgrade } from "@/cli/utils/version-check.js";

const UPGRADE_COMMAND = "npm install -g base44@latest";

function formatUpgradeBox(info: UpgradeInfo): string {
  const { shinyOrange } = theme.colors;
  const { bold } = theme.styles;

  const lines = [
    shinyOrange(
      `Update available! ${info.currentVersion} → ${bold(info.latestVersion)}`,
    ),
    shinyOrange(`Run: ${bold(UPGRADE_COMMAND)}`),
    "",
    "[Agent Hints]",
    `  Run: ${UPGRADE_COMMAND}`,
  ];

  const maxVisualWidth = Math.max(...lines.map((l) => stripAnsi(l).length));
  const pad = (line: string) => {
    const visual = stripAnsi(line).length;
    return `${line}${" ".repeat(maxVisualWidth - visual)}`;
  };

  const top = `┌${"─".repeat(maxVisualWidth + 2)}┐`;
  const bottom = `└${"─".repeat(maxVisualWidth + 2)}┘`;
  const body = lines.map((l) => `│ ${pad(l)} │`).join("\n");

  return `${top}\n${body}\n${bottom}`;
}

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
      log.warn(formatUpgradeBox(upgradeInfo));
    }
  } catch {
    // Silently ignore errors
  }
}
