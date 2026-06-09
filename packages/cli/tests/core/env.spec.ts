import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProjectEnvFiles } from "@/core/utils/env.js";

// Keys this suite manipulates; saved and restored around each test so we never
// leak into the real process environment.
const KEYS = [
  "LPE_FOO",
  "LPE_BAR",
  "LPE_PRESET",
  "BASE44_APP_ID",
  "ACME_BASE44_APP_ID",
  "OTHER_BASE44_APP_ID",
];

describe("loadProjectEnvFiles", () => {
  let dir: string;
  let saved: Record<string, string | undefined>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "b44-env-"));
    saved = {};
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(async () => {
    for (const key of KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("loads values from .env", async () => {
    await writeFile(join(dir, ".env"), "LPE_FOO=from_env\n");

    loadProjectEnvFiles(dir);

    expect(process.env.LPE_FOO).toBe("from_env");
  });

  it("lets .env.local override .env", async () => {
    await writeFile(join(dir, ".env"), "LPE_BAR=from_env\n");
    await writeFile(join(dir, ".env.local"), "LPE_BAR=from_local\n");

    loadProjectEnvFiles(dir);

    expect(process.env.LPE_BAR).toBe("from_local");
  });

  it("never overrides a value already present in process.env", async () => {
    process.env.LPE_PRESET = "ambient";
    await writeFile(join(dir, ".env"), "LPE_PRESET=from_env\n");

    loadProjectEnvFiles(dir);

    expect(process.env.LPE_PRESET).toBe("ambient");
  });

  it("ignores missing files", () => {
    expect(() => loadProjectEnvFiles(dir)).not.toThrow();
  });

  it("normalizes a prefix-namespaced BASE44_APP_ID to the bare name", async () => {
    // Mirrors a tool that writes a prefixed var like <PREFIX>_BASE44_APP_ID.
    await writeFile(join(dir, ".env"), "ACME_BASE44_APP_ID=app_prefixed\n");

    loadProjectEnvFiles(dir);

    expect(process.env.BASE44_APP_ID).toBe("app_prefixed");
  });

  it("does not override a bare BASE44_APP_ID with a prefixed one", async () => {
    process.env.BASE44_APP_ID = "app_bare";
    await writeFile(join(dir, ".env"), "ACME_BASE44_APP_ID=app_prefixed\n");

    loadProjectEnvFiles(dir);

    expect(process.env.BASE44_APP_ID).toBe("app_bare");
  });

  it("leaves the bare key unset when prefixed vars are ambiguous", async () => {
    await writeFile(
      join(dir, ".env"),
      "ACME_BASE44_APP_ID=app_one\nOTHER_BASE44_APP_ID=app_two\n",
    );

    loadProjectEnvFiles(dir);

    expect(process.env.BASE44_APP_ID).toBeUndefined();
  });
});
