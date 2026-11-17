import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProjectEnvFiles, loadSavedLoginApiUrl } from "@/core/utils/env.js";

// Keys this suite manipulates; saved and restored around each test so we never
// leak into the real process environment.
const KEYS = [
  "LPE_FOO",
  "LPE_BAR",
  "LPE_PRESET",
  "BASE44_APP_ID",
  "BASE44_PROJECTS_BASE44_APP_ID",
  "ACME_BASE44_APP_ID",
  "BASE44_API_URL",
  "BASE44_ACCESS_TOKEN",
  "BASE44_API_KEY",
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

  it("uses the saved login's host when nothing else sets one", async () => {
    const authFile = join(dir, "auth.json");
    await writeFile(authFile, '{"apiUrl":"https://acme.example.com"}');

    loadSavedLoginApiUrl(authFile);

    expect(process.env.BASE44_API_URL).toBe("https://acme.example.com");
  });

  it("ignores the saved login's host when credentials come from the environment", async () => {
    const authFile = join(dir, "auth.json");
    await writeFile(authFile, '{"apiUrl":"https://acme.example.com"}');
    process.env.BASE44_ACCESS_TOKEN = "token";

    loadSavedLoginApiUrl(authFile);

    expect(process.env.BASE44_API_URL).toBeUndefined();
  });

  it("loads values from .env", async () => {
    await writeFile(join(dir, ".env"), "LPE_FOO=from_env\n");

    loadProjectEnvFiles(dir);

    expect(process.env.LPE_FOO).toBe("from_env");
  });

  it("loads .env from the project root when run in a subdirectory", async () => {
    await writeFile(join(dir, ".env"), "LPE_FOO=from_root\n");
    const base44Dir = join(dir, "base44");
    await mkdir(base44Dir, { recursive: true });
    await writeFile(join(base44Dir, "config.jsonc"), "{}\n");
    const sub = join(base44Dir, "functions");
    await mkdir(sub, { recursive: true });

    loadProjectEnvFiles(sub);

    expect(process.env.LPE_FOO).toBe("from_root");
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

  it("normalizes the Stripe-prefixed BASE44_APP_ID to the bare name", async () => {
    // The Stripe Projects CLI writes BASE44_PROJECTS_BASE44_APP_ID.
    await writeFile(
      join(dir, ".env"),
      "BASE44_PROJECTS_BASE44_APP_ID=app_prefixed\n",
    );

    loadProjectEnvFiles(dir);

    expect(process.env.BASE44_APP_ID).toBe("app_prefixed");
  });

  it("does not override a bare BASE44_APP_ID with the Stripe-prefixed one", async () => {
    process.env.BASE44_APP_ID = "app_bare";
    await writeFile(
      join(dir, ".env"),
      "BASE44_PROJECTS_BASE44_APP_ID=app_prefixed\n",
    );

    loadProjectEnvFiles(dir);

    expect(process.env.BASE44_APP_ID).toBe("app_bare");
  });

  it("ignores prefixes other than the Stripe one", async () => {
    await writeFile(join(dir, ".env"), "ACME_BASE44_APP_ID=app_other\n");

    loadProjectEnvFiles(dir);

    expect(process.env.BASE44_APP_ID).toBeUndefined();
  });
});
