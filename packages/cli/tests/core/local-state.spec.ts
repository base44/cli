import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type DevInstance,
  deleteDevInstance,
  getDataDir,
  getDevJsonPath,
  getMetaJsonPath,
  getStateDir,
  isPidAlive,
  readDataDirMeta,
  readDevInstance,
  writeDataDirMeta,
  writeDevInstance,
} from "@/core/local-state/index.js";
import { pathExists } from "@/core/utils/fs.js";

/** Spawn a short-lived process and wait for it to exit, returning a dead pid. */
async function getDeadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  if (!pid) {
    throw new Error("Failed to spawn process for dead-pid setup");
  }
  await new Promise((resolve) => child.once("exit", resolve));
  return pid;
}

function buildInstance(overrides: Partial<DevInstance> = {}): DevInstance {
  return {
    appId: "app-123",
    url: "http://localhost:4400",
    port: 4400,
    pid: process.pid,
    dataDir: "/tmp/data",
    adminToken: "a".repeat(64),
    startedAt: "2026-01-01T00:00:00.000Z",
    seed: null,
    ...overrides,
  };
}

describe("local-state", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "b44-local-state-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  describe("paths", () => {
    it("derives state, data, dev.json and meta.json paths from the project root", () => {
      expect(getStateDir(projectRoot)).toBe(join(projectRoot, ".base44"));
      expect(getDataDir(projectRoot)).toBe(
        join(projectRoot, ".base44", "data"),
      );
      expect(getDevJsonPath(projectRoot)).toBe(
        join(projectRoot, ".base44", "dev.json"),
      );
      expect(getMetaJsonPath(getDataDir(projectRoot))).toBe(
        join(projectRoot, ".base44", "data", "meta.json"),
      );
    });
  });

  describe("data dir meta", () => {
    it("round-trips meta.json", async () => {
      const dataDir = getDataDir(projectRoot);

      await writeDataDirMeta(dataDir, {
        formatVersion: 1,
        appId: "app-123",
        seed: null,
      });

      const result = await readDataDirMeta(dataDir);
      expect(result).toEqual({
        status: "ok",
        meta: { formatVersion: 1, appId: "app-123", seed: null },
      });
    });

    it("reports missing meta.json", async () => {
      const result = await readDataDirMeta(getDataDir(projectRoot));
      expect(result).toEqual({ status: "missing" });
    });

    it("reports corrupt meta.json for unparseable JSON", async () => {
      const dataDir = getDataDir(projectRoot);
      await mkdir(dataDir, { recursive: true });
      await writeFile(getMetaJsonPath(dataDir), "not json {{{");

      const result = await readDataDirMeta(dataDir);
      expect(result).toEqual({ status: "corrupt" });
    });

    it("reports corrupt meta.json for schema-invalid content", async () => {
      const dataDir = getDataDir(projectRoot);
      await mkdir(dataDir, { recursive: true });
      await writeFile(
        getMetaJsonPath(dataDir),
        JSON.stringify({ formatVersion: 999, appId: 42 }),
      );

      const result = await readDataDirMeta(dataDir);
      expect(result).toEqual({ status: "corrupt" });
    });
  });

  describe("dev instance descriptor", () => {
    it("round-trips dev.json for a live pid", async () => {
      const instance = buildInstance();

      await writeDevInstance(projectRoot, instance);

      await expect(readDevInstance(projectRoot)).resolves.toEqual(instance);
    });

    it("returns null when dev.json is missing", async () => {
      await expect(readDevInstance(projectRoot)).resolves.toBeNull();
    });

    it("deletes dev.json and returns null when the pid is not alive", async () => {
      const instance = buildInstance({ pid: await getDeadPid() });
      await writeDevInstance(projectRoot, instance);

      await expect(readDevInstance(projectRoot)).resolves.toBeNull();
      await expect(pathExists(getDevJsonPath(projectRoot))).resolves.toBe(
        false,
      );
    });

    it("deletes dev.json and returns null when the content is invalid", async () => {
      await mkdir(getStateDir(projectRoot), { recursive: true });
      await writeFile(getDevJsonPath(projectRoot), '{"port": "nope"}');

      await expect(readDevInstance(projectRoot)).resolves.toBeNull();
      await expect(pathExists(getDevJsonPath(projectRoot))).resolves.toBe(
        false,
      );
    });

    it("deletes dev.json on deleteDevInstance and tolerates a missing file", async () => {
      await writeDevInstance(projectRoot, buildInstance());
      const raw = await readFile(getDevJsonPath(projectRoot), "utf-8");
      expect(JSON.parse(raw).adminToken).toBe("a".repeat(64));

      await deleteDevInstance(projectRoot);
      await expect(pathExists(getDevJsonPath(projectRoot))).resolves.toBe(
        false,
      );

      // Second delete is a no-op.
      await expect(deleteDevInstance(projectRoot)).resolves.toBeUndefined();
    });
  });

  describe("isPidAlive", () => {
    it("is true for the current process and false for an exited one", async () => {
      expect(isPidAlive(process.pid)).toBe(true);
      expect(isPidAlive(await getDeadPid())).toBe(false);
    });
  });
});
