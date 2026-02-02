import { execa } from "execa";
import packageJson from "../../../package.json";

export interface UpgradeInfo {
  currentVersion: string;
  latestVersion: string;
}

/**
 * Checks if a newer version of the CLI is available.
 */
export async function checkForUpgrade(): Promise<UpgradeInfo | null> {
  try {
    const { stdout } = await execa("npm", ["view", "base44", "version"], {
      timeout: 5000,
      shell: true,
    });
    const latestVersion = stdout.trim();
    const currentVersion = packageJson.version;

    if (latestVersion !== currentVersion) {
      return { currentVersion, latestVersion };
    }
    return null;
  } catch {
    return null;
  }
}
