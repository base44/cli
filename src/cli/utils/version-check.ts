import { execa } from "execa";
import packageJson from "../../../package.json";

export interface UpgradeInfo {
  currentVersion: string;
  latestVersion: string;
}

/**
 * Load test override for latest version from BASE44_CLI_TEST_OVERRIDES.
 * Returns undefined if no override, or the override value (which may be null to simulate "no update").
 */
function getTestLatestVersion(): string | null | undefined {
  const overrides = process.env.BASE44_CLI_TEST_OVERRIDES;
  if (!overrides) {
    return undefined;
  }
  try {
    const data = JSON.parse(overrides);
    return data.latestVersion;
  } catch {
    return undefined;
  }
}

/**
 * Checks if a newer version of the CLI is available.
 */
export async function checkForUpgrade(): Promise<UpgradeInfo | null> {
  // Check for test override
  const testLatestVersion = getTestLatestVersion();
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
