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

  it("stop() terminates a long-running process", async () => {
    const { logger } = fakeLogger();
    const exitCodes: Array<number | null> = [];
    const runner = new ServeRunner({
      command: `node -e "setInterval(() => {}, 1000)"`,
      cwd: process.cwd(),
      env: {},
      logger,
    });
    runner.onExit((code) => exitCodes.push(code));

    runner.start();
    await new Promise((r) => setTimeout(r, 200));
    await runner.stop();

    // stop() must resolve, and the intentional stop must NOT fire onExit.
    expect(exitCodes).toEqual([]);
  });

  it("fires onExit when the process exits on its own", async () => {
    const { logger } = fakeLogger();
    const exitCodes: Array<number | null> = [];
    const runner = new ServeRunner({
      command: `node -e "process.exit(3)"`,
      cwd: process.cwd(),
      env: {},
      logger,
    });
    runner.onExit((code) => exitCodes.push(code));

    runner.start();
    await waitFor(() => exitCodes.length > 0);

    expect(exitCodes).toEqual([3]);
  });
});
