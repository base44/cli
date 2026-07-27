import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../../package.json";

// `assets.ts` resolves the assets directory from the home directory at module
// load, so each test points HOME at a fresh temp dir and re-imports it.
const loadAssets = async () => {
  vi.resetModules();
  return import("@/core/assets.js");
};

describe("ensureNpmAssets", () => {
  let home: string;
  let source: string;
  let savedHome: string | undefined;
  let savedUserProfile: string | undefined;

  const versionDir = () => join(home, ".base44", "assets", packageJson.version);

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "b44-assets-home-"));
    source = await mkdtemp(join(tmpdir(), "b44-assets-src-"));

    savedHome = process.env.HOME;
    savedUserProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    // os.homedir() reads USERPROFILE on Windows.
    process.env.USERPROFILE = home;

    // A minimal stand-in for dist/assets/.
    await mkdir(join(source, "backend-runtime"), { recursive: true });
    await writeFile(join(source, "backend-runtime", "main.ts"), "// wrapper");
    await mkdir(join(source, "templates"), { recursive: true });
    await writeFile(join(source, "templates", "templates.json"), "{}");
  });

  afterEach(async () => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedUserProfile;

    await rm(home, { recursive: true, force: true });
    await rm(source, { recursive: true, force: true });
  });

  it("copies assets on first run", async () => {
    const { ensureNpmAssets, getDenoWrapperPath } = await loadAssets();

    ensureNpmAssets(source);

    expect(existsSync(getDenoWrapperPath())).toBe(true);
  });

  it("refreshes a version directory left behind by an older asset layout", async () => {
    // Simulate an install from before `backend-runtime/` existed: the version
    // directory is present, but only holds the previous layout. Guarding on
    // the version directory alone would skip the copy and leave the wrapper
    // permanently missing for anyone already on this version.
    await mkdir(join(versionDir(), "deno-runtime"), { recursive: true });
    await writeFile(join(versionDir(), "deno-runtime", "main.ts"), "// stale");

    const { ensureNpmAssets, getDenoWrapperPath } = await loadAssets();

    ensureNpmAssets(source);

    expect(existsSync(getDenoWrapperPath())).toBe(true);
  });

  it("does not re-copy when the expected assets are already present", async () => {
    const { ensureNpmAssets, getDenoWrapperPath } = await loadAssets();

    ensureNpmAssets(source);
    // Local edits to an already-populated directory must survive, which is
    // what makes the copy a one-time bootstrap rather than a sync.
    await writeFile(getDenoWrapperPath(), "// locally modified");
    ensureNpmAssets(source);

    const contents = await readFile(getDenoWrapperPath(), "utf-8");
    expect(contents).toBe("// locally modified");
  });
});
