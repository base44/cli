import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BASE44_APP_ID_ENV_VAR } from "@/core/consts.js";
import { initAppContext, resetAppContext } from "@/core/project/app-config.js";

const originalCwd = process.cwd();
const originalAppId = process.env[BASE44_APP_ID_ENV_VAR];

async function createLinkedProject(appId: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "base44-app-config-"));
  await mkdir(join(projectRoot, "base44"), { recursive: true });
  await writeFile(
    join(projectRoot, "base44", "config.jsonc"),
    '{ "name": "App Config Test" }',
  );
  await writeFile(
    join(projectRoot, "base44", ".app.jsonc"),
    `{ "id": "${appId}" }`,
  );
  return await realpath(projectRoot);
}

describe("initAppContext", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    // chdir back before cleanup — on Windows, deleting the cwd throws EBUSY
    process.chdir(originalCwd);
    resetAppContext();
    if (originalAppId === undefined) {
      delete process.env[BASE44_APP_ID_ENV_VAR];
    } else {
      process.env[BASE44_APP_ID_ENV_VAR] = originalAppId;
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("uses an explicit app id before local config", async () => {
    tempDir = await createLinkedProject("app-from-file");
    process.chdir(tempDir);
    process.env[BASE44_APP_ID_ENV_VAR] = "app-from-env";

    await expect(initAppContext({ appId: "app-from-flag" })).resolves.toEqual({
      id: "app-from-flag",
    });
  });

  it("does not read BASE44_APP_ID directly", async () => {
    tempDir = await createLinkedProject("app-from-file");
    process.chdir(tempDir);
    process.env[BASE44_APP_ID_ENV_VAR] = "app-from-env";

    await expect(initAppContext()).resolves.toEqual({
      id: "app-from-file",
      projectRoot: tempDir,
    });
  });

  it("uses local .app.jsonc when no explicit app id is present", async () => {
    tempDir = await createLinkedProject("app-from-file");
    process.chdir(tempDir);
    delete process.env[BASE44_APP_ID_ENV_VAR];

    await expect(initAppContext()).resolves.toEqual({
      id: "app-from-file",
      projectRoot: tempDir,
    });
  });

  it("throws a helpful error when no app id source is available", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "base44-no-app-config-"));
    process.chdir(tempDir);
    delete process.env[BASE44_APP_ID_ENV_VAR];

    await expect(initAppContext()).rejects.toThrow(/No Base44 app ID found/);
    await expect(initAppContext()).rejects.toThrow(/--app-id/);
    await expect(initAppContext()).rejects.toThrow(/BASE44_APP_ID/);
    await expect(initAppContext()).rejects.toThrow(/base44\/.app.jsonc/);
  });

  it("rejects an empty explicit app id", async () => {
    await expect(initAppContext({ appId: "   " })).rejects.toThrow(
      /app id cannot be empty/i,
    );
  });

  it("ignores an empty BASE44_APP_ID", async () => {
    tempDir = await createLinkedProject("app-from-file");
    process.chdir(tempDir);
    process.env[BASE44_APP_ID_ENV_VAR] = "   ";

    await expect(initAppContext()).resolves.toEqual({
      id: "app-from-file",
      projectRoot: tempDir,
    });
  });
});
