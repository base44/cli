import { describe, it, vi, beforeEach } from "vitest";
import { setupCLITests } from "./testkit/index.js";
import type { UpgradeInfo } from "@/cli/utils/version-check.js";

// Mock the version-check module
vi.mock("@/cli/utils/version-check.js", () => ({
  checkForUpgrade: vi.fn(),
}));

describe("upgrade notification", () => {
  const t = setupCLITests();

  beforeEach(async () => {
    const { checkForUpgrade } = await import("@/cli/utils/version-check.js");
    vi.mocked(checkForUpgrade).mockReset();
  });

  it("displays upgrade notification when newer version is available", async () => {
    const { checkForUpgrade } = await import("@/cli/utils/version-check.js");
    const upgradeInfo: UpgradeInfo = {
      currentVersion: "0.0.26",
      latestVersion: "1.0.0",
    };
    vi.mocked(checkForUpgrade).mockResolvedValue(upgradeInfo);

    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Update available!");
    t.expectResult(result).toContain("0.0.26 → 1.0.0");
    t.expectResult(result).toContain("npm update -g base44");
  });

  it("does not display notification when version is current", async () => {
    const { checkForUpgrade } = await import("@/cli/utils/version-check.js");
    vi.mocked(checkForUpgrade).mockResolvedValue(null);

    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).not.toContain("Update available!");
  });

  it("does not display notification when version check fails", async () => {
    const { checkForUpgrade } = await import("@/cli/utils/version-check.js");
    vi.mocked(checkForUpgrade).mockRejectedValue(new Error("Network error"));

    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("whoami");

    // Command still succeeds (upgrade check doesn't block)
    t.expectResult(result).toSucceed();
    t.expectResult(result).not.toContain("Update available!");
  });
});
