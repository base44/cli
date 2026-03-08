import { execa } from "execa";
import { getTestOverrides } from "@/core/config.js";
import packageJson from "../../../package.json";

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
      timeout: 1000,
      shell: true,
      env: { CI: "1" },
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
