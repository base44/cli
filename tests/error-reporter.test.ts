import { describe, it, expect, beforeEach, vi } from "vitest";
import { ErrorReporter } from "../src/cli/error-reporter.js";

describe("ErrorReporter", () => {
  let reporter: ErrorReporter;

  beforeEach(() => {
    reporter = new ErrorReporter();
  });

  it("should be disabled by default", () => {
    expect(reporter.enabled).toBe(false);
  });

  it("should not throw when capturing exception without initialization", async () => {
    const error = new Error("Test error");
    await expect(reporter.captureException(error)).resolves.not.toThrow();
  });

  it("should not throw when shutting down without initialization", async () => {
    await expect(reporter.shutdown()).resolves.not.toThrow();
  });

  it("should warn when initialized without API key", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    reporter.initialize("");
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "PostHog API key not provided. Error reporting disabled."
    );
    expect(reporter.enabled).toBe(false);
    consoleWarnSpy.mockRestore();
  });

  it("should handle multiple shutdown calls gracefully", async () => {
    reporter.initialize("test-key");
    const shutdown1 = reporter.shutdown();
    const shutdown2 = reporter.shutdown();
    await expect(Promise.all([shutdown1, shutdown2])).resolves.not.toThrow();
  });
});
