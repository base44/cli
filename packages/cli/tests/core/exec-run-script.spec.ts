import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runScript } from "../../src/core/exec/run-script.js";

const spawnMock = vi.fn();
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const getAppUserToken = vi.fn();
const getSiteUrl = vi.fn();
vi.mock("../../src/core/project/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/project/api.js")>()),
  getAppUserToken: () => getAppUserToken(),
  getSiteUrl: () => getSiteUrl(),
}));

vi.mock("../../src/core/utils/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/utils/index.js")>()),
  verifyDenoInstalled: () => {},
}));

vi.mock("../../src/core/assets.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/assets.js")>()),
  getExecWrapperPath: () =>
    join(import.meta.dirname, "../../backend-runtime/exec.ts"),
}));

type ChildEnv = Record<string, string | undefined>;

function spawnedEnv(): ChildEnv {
  expect(spawnMock).toHaveBeenCalledTimes(1);
  return spawnMock.mock.calls[0][2].env as ChildEnv;
}

const EXEC_VARS = {
  BASE44_EXEC_ACCESS_TOKEN: "env-token",
  BASE44_EXEC_SERVER_URL: "https://sandbox.example.com",
  BASE44_EXEC_SERVICE_TOKEN: "env-service-token",
  BASE44_PRIVILEGED: "1",
  BASE44_DATA_ENV: "dev",
};

let configContents: Record<string, unknown>;
let wrapperContents = "";

describe("runScript", () => {
  beforeEach(() => {
    configContents = {};
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const configPath = args[args.indexOf("--config") + 1];
      configContents[configPath] = JSON.parse(
        readFileSync(configPath, "utf-8"),
      );
      wrapperContents = readFileSync(args[args.length - 1], "utf-8");
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });
    getAppUserToken.mockResolvedValue("remote-token");
    getSiteUrl.mockResolvedValue("https://app.base44.app");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses an explicit target without the token exchange or published-url lookup", async () => {
    for (const [name, value] of Object.entries(EXEC_VARS)) {
      vi.stubEnv(name, value);
    }

    const { exitCode } = await runScript({
      appId: "app-1",
      code: "console.log(1)",
      local: { token: "env-token", serverUrl: "https://sandbox.example.com" },
      serviceToken: "env-service-token",
    });

    expect(exitCode).toBe(0);
    expect(getAppUserToken).not.toHaveBeenCalled();
    expect(getSiteUrl).not.toHaveBeenCalled();
    const env = spawnedEnv();
    expect(env.BASE44_APP_ID).toBe("app-1");
    expect(env.BASE44_ACCESS_TOKEN).toBe("env-token");
    expect(env.BASE44_APP_BASE_URL).toBe("https://sandbox.example.com");
    expect(env.BASE44_SERVICE_TOKEN).toBe("env-service-token");
    for (const name of Object.keys(EXEC_VARS)) {
      expect(env).not.toHaveProperty(name);
    }
  });

  it("runs Deno in the caller's cwd without writing its node_modules", async () => {
    await runScript({ appId: "app-1", code: "console.log(1)" });

    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe("deno");
    expect(args.slice(0, 3)).toEqual([
      "run",
      "--allow-all",
      "--node-modules-dir=none",
    ]);
    expect(args).not.toContain("--node-modules-dir=auto");
    const configPath = args[args.indexOf("--config") + 1];
    expect(configContents).toEqual({
      [configPath]: { minimumDependencyAge: { exclude: ["npm:@base44/sdk"] } },
    });
    expect(options.cwd).toBeUndefined();
  });

  it("keeps the default path unchanged: remote lookups, no extra wrapper env", async () => {
    vi.stubEnv("BASE44_SERVICE_TOKEN", "ambient");

    await runScript({ appId: "app-1", code: "console.log(1)" });

    expect(getAppUserToken).toHaveBeenCalledTimes(1);
    expect(getSiteUrl).toHaveBeenCalledTimes(1);
    const env = spawnedEnv();
    expect(env.BASE44_ACCESS_TOKEN).toBe("remote-token");
    expect(env.BASE44_APP_BASE_URL).toBe("https://app.base44.app");
    expect(env).not.toHaveProperty("BASE44_SERVICE_TOKEN");
    expect(env).not.toHaveProperty("BASE44_PRIVILEGED");
    expect(env).not.toHaveProperty("BASE44_DATA_ENV");
  });

  it("imports the latest SDK unless a version is given", async () => {
    await runScript({ appId: "app-1", code: "console.log(1)" });

    expect(wrapperContents.match(/"npm:@base44\/sdk[^"]*"/g)).toEqual([
      '"npm:@base44/sdk"',
    ]);
  });

  it("pins the SDK import to the given version", async () => {
    await runScript({
      appId: "app-1",
      code: "console.log(1)",
      sdkVersion: "0.8.48",
    });

    expect(wrapperContents.match(/"npm:@base44\/sdk[^"]*"/g)).toEqual([
      '"npm:@base44/sdk@0.8.48"',
    ]);
  });
});
