import { describe, expect, it } from "vitest";
import { ServeRunner } from "@/cli/dev/dev-server/serve-runner.js";

function fakeLogger() {
  const lines: string[] = [];
  return {
    lines,
    logger: {
      log: (...args: unknown[]) => lines.push(args.join(" ")),
      error: (msg: unknown) => lines.push(String(msg)),
      warn: (...args: unknown[]) => lines.push(args.join(" ")),
    },
  };
}

const waitFor = async (predicate: () => boolean, timeoutMs = 5000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe("ServeRunner", () => {
  it("spawns the command with injected env vars", async () => {
    const { lines, logger } = fakeLogger();
    const runner = new ServeRunner({
      command: `node -e "console.log('APP=' + process.env.VITE_BASE44_APP_ID)"`,
      cwd: process.cwd(),
      env: { VITE_BASE44_APP_ID: "abc-123" },
      logger,
    });

    runner.start();
    await waitFor(() => lines.some((l) => l.includes("APP=abc-123")));
    await runner.stop();

    expect(lines.some((l) => l.includes("APP=abc-123"))).toBe(true);
  });
});
