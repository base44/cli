import { describe, expect, it, vi } from "vitest";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";
import { ServeRunner } from "@/cli/dev/dev-server/serve-runner.js";

const noopLogger: DevLogger = {
  log: () => {},
  error: () => {},
  warn: () => {},
};

describe("ServeRunner", () => {
  it("reports the first localhost URL the serve command prints", async () => {
    const urls: string[] = [];
    const runner = new ServeRunner({
      command: `node -e "console.log('  Local:   http://localhost:5173/'); console.log('  Network: http://localhost:5174/')"`,
      cwd: process.cwd(),
      env: {},
      logger: noopLogger,
      onUrl: (url) => urls.push(url),
    });

    runner.start();

    await vi.waitFor(() => expect(urls).toEqual(["http://localhost:5173"]));
    await runner.stop();
  });

  it("does not report a URL when the serve output has none", async () => {
    const urls: string[] = [];
    const exited = new Promise<void>((resolve) => {
      const runner = new ServeRunner({
        command: `node -e "console.log('starting up, nothing to open')"`,
        cwd: process.cwd(),
        env: {},
        logger: noopLogger,
        onUrl: (url) => urls.push(url),
      });
      runner.onExit(() => resolve());
      runner.start();
    });

    await exited;
    expect(urls).toEqual([]);
  });
});
