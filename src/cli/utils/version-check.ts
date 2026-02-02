import { execa } from "execa";
import packageJson from "../../../package.json";
import { getTestOverrides } from "@/core/config.js";

export interface UpgradeInfo {
  currentVersion: string;
  latestVersion: string;
}

export async function checkForUpgrade(): Promise<UpgradeInfo | null> {
  const testLatestVersion = getTestOverrides()?.latestVersion;
  if (testLatestVersion !== undefined) {
    if (testLatestVersion === null) {
      return null;
    }
    const currentVersion = packageJson.version;
    if (testLatestVersion !== currentVersion) {
      return { currentVersion, latestVersion: testLatestVersion };
    }
    return null;
  }

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
