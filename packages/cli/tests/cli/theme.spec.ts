import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";
import { theme } from "../../src/cli/utils/theme.js";

describe("theme.format.agentHints", () => {
  it("prints the command when a command is present", () => {
    const output = theme.format.agentHints([
      {
        message: "Run from a linked Base44 project",
        command: "base44 link",
      },
    ]);

    expect(stripAnsi(output ?? "")).toBe("[Agent Hints]\n  Run: base44 link");
  });
});
