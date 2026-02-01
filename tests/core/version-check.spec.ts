import { describe, it, expect, vi, beforeEach } from "vitest";
import { execa } from "execa";
import { checkForUpgrade } from "@/core/utils/version-check.js";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

const mockedExeca = vi.mocked(execa);

describe("checkForUpgrade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns upgrade info when newer version is available", async () => {
    mockedExeca.mockResolvedValue({ stdout: "1.0.0" } as never);

    const result = await checkForUpgrade();

    expect(result).not.toBeNull();
    expect(result?.latestVersion).toBe("1.0.0");
    expect(mockedExeca).toHaveBeenCalledWith(
      "npm",
      ["view", "base44", "version"],
      { timeout: 5000 }
    );
  });

  it("returns null when version is the same", async () => {
    // Mock returns same version as package.json (0.0.26)
    mockedExeca.mockResolvedValue({ stdout: "0.0.26" } as never);

    const result = await checkForUpgrade();

    expect(result).toBeNull();
  });

  it("returns null when npm command fails", async () => {
    mockedExeca.mockRejectedValue(new Error("Network error"));

    const result = await checkForUpgrade();

    expect(result).toBeNull();
  });

  it("trims whitespace from version output", async () => {
    mockedExeca.mockResolvedValue({ stdout: "  2.0.0\n" } as never);

    const result = await checkForUpgrade();

    expect(result?.latestVersion).toBe("2.0.0");
  });
});
