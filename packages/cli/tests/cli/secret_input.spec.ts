import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @clack/prompts before importing
vi.mock("@clack/prompts", () => ({
  password: vi.fn(),
  isCancel: (value: unknown) => value === Symbol.for("cancel"),
}));

import { password } from "@clack/prompts";
import { resolveSecret } from "../../src/cli/utils/secret-input.js";

const baseOptions = {
  promptMessage: "Enter secret",
  isNonInteractive: false,
  name: "test secret",
};

describe("resolveSecret", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    delete process.env.TEST_SECRET_VAR;
  });

  it("returns flag value when provided", async () => {
    const result = await resolveSecret({
      ...baseOptions,
      flagValue: "from-flag",
    });

    expect(result).toBe("from-flag");
  });

  it("returns env var when flag is absent", async () => {
    process.env.TEST_SECRET_VAR = "from-env";

    const result = await resolveSecret({
      ...baseOptions,
      envVar: "TEST_SECRET_VAR",
    });

    expect(result).toBe("from-env");
  });

  it("prefers flag value over env var", async () => {
    process.env.TEST_SECRET_VAR = "from-env";

    const result = await resolveSecret({
      ...baseOptions,
      flagValue: "from-flag",
      envVar: "TEST_SECRET_VAR",
    });

    expect(result).toBe("from-flag");
  });

  it("falls back to interactive prompt when no flag or env var", async () => {
    vi.mocked(password).mockResolvedValue("from-prompt");

    const result = await resolveSecret({
      ...baseOptions,
    });

    expect(result).toBe("from-prompt");
    expect(password).toHaveBeenCalledOnce();
  });

  it("throws in non-interactive mode when no value available", async () => {
    await expect(
      resolveSecret({
        ...baseOptions,
        isNonInteractive: true,
      }),
    ).rejects.toThrow("Missing required test secret");
  });

  it("does not prompt in non-interactive mode", async () => {
    await expect(
      resolveSecret({
        ...baseOptions,
        isNonInteractive: true,
      }),
    ).rejects.toThrow();

    expect(password).not.toHaveBeenCalled();
  });

  it("includes custom hints in error when provided", async () => {
    try {
      await resolveSecret({
        ...baseOptions,
        isNonInteractive: true,
        hints: [
          { message: "Use --my-secret flag", command: "cmd --my-secret x" },
        ],
      });
    } catch (error: unknown) {
      expect(
        (error as { hints: Array<{ message: string }> }).hints[0].message,
      ).toContain("--my-secret");
      return;
    }
    expect.fail("Expected error to be thrown");
  });
});
