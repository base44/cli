import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initAppContext, resetAppContext } from "@/core/project/app-config.js";

const originalCwd = process.cwd();

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
  afterEach(() => {
    process.chdir(originalCwd);
    resetAppContext();
  });

  it("uses local .app.jsonc", async () => {
    const projectRoot = await createLinkedProject("app-from-file");
    process.chdir(projectRoot);

    try {
      await expect(initAppContext()).resolves.toEqual({
        id: "app-from-file",
        projectRoot,
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns cached app context after the first initialization", async () => {
    const projectRoot = await createLinkedProject("app-from-file");
    process.chdir(projectRoot);

    try {
      const first = await initAppContext();
      const second = await initAppContext();

      expect(first).toEqual({
        id: "app-from-file",
        projectRoot,
      });
      expect(second).toBe(first);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("throws when no project is available", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "base44-no-app-config-"));
    process.chdir(emptyDir);

    try {
      await expect(initAppContext()).rejects.toThrow(/No Base44 project found/);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
