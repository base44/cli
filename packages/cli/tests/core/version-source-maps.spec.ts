import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectArtifacts } from "@/core/version/artifacts.js";
import type { ArtifactFile } from "@/core/version/schema.js";
import { collectSourceMaps } from "@/core/version/source-maps.js";

const MAP = '{"version":3,"mappings":"AAAA"}';

/** Paths whose read fails, as a map's would once it is gone or locked. */
const unreadable = new Set<string>();
vi.mock("@/core/version/digest.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/core/version/digest.js")>();
  return {
    digestFile: async (absolutePath: string) => {
      if (unreadable.has(absolutePath)) {
        throw new Error(`EACCES: permission denied, open '${absolutePath}'`);
      }
      return await actual.digestFile(absolutePath);
    },
  };
});

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function asset(path: string): ArtifactFile {
  return { path, absolutePath: `/dist/${path}`, size: 1, digest: "sha256:0" };
}

describe("collectSourceMaps", () => {
  let projectRoot: string;
  let mapsDir: string;
  let warnings: string[];

  const collect = (assets: ArtifactFile[] = [asset("assets/app.js")]) =>
    collectSourceMaps(projectRoot, assets, {
      onWarning: (message) => warnings.push(message),
    });

  const givenManifest = (manifest: unknown) =>
    writeFile(join(mapsDir, "manifest.json"), JSON.stringify(manifest));

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "b44-maps-"));
    mapsDir = join(projectRoot, ".base44", "source-maps");
    await mkdir(join(mapsDir, "assets"), { recursive: true });
    await writeFile(join(mapsDir, "assets", "app.js.map"), MAP);
    warnings = [];
    unreadable.clear();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("is absent without a manifest, so nothing new is declared", async () => {
    expect(await collect()).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("describes each map by its bundle, size and full sha256", async () => {
    await givenManifest({
      version: 1,
      maps: [{ file: "assets/app.js.map", bundle: "assets/app.js" }],
    });

    expect(await collect()).toEqual([
      {
        bundle: "assets/app.js",
        file: "assets/app.js.map",
        // Resolved, so a temp folder reached through a link still compares.
        absolutePath: await realpath(join(mapsDir, "assets", "app.js.map")),
        size: MAP.length,
        digest: sha256(MAP),
      },
    ]);
  });

  it("keeps the first of two maps that name one bundle", async () => {
    await writeFile(join(mapsDir, "assets", "other.js.map"), "{}");
    await givenManifest({
      version: 1,
      maps: [
        { file: "assets/app.js.map", bundle: "assets/app.js" },
        { file: "assets/other.js.map", bundle: "assets/app.js" },
      ],
    });

    const maps = await collect();

    expect(maps?.map((m) => m.file)).toEqual(["assets/app.js.map"]);
    expect(warnings).toHaveLength(1);
  });

  it("does not follow a link out of its folder", async () => {
    const outside = join(projectRoot, "secret.txt");
    await writeFile(outside, "secret");
    await symlink(outside, join(mapsDir, "assets", "linked.js.map"));
    await givenManifest({
      version: 1,
      maps: [{ file: "assets/linked.js.map", bundle: "assets/app.js" }],
    });

    // The manifest is this build's, so it is declared, with no maps.
    expect(await collect()).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("does not follow a linked directory out of its folder", async () => {
    // A link anywhere on the path, not just the last segment: `assets/` itself
    // pointing elsewhere reaches the same files.
    const elsewhere = join(projectRoot, "elsewhere");
    await mkdir(elsewhere);
    await writeFile(join(elsewhere, "app.js.map"), MAP);
    await symlink(elsewhere, join(mapsDir, "linked"), "dir");
    await givenManifest({
      version: 1,
      maps: [{ file: "linked/app.js.map", bundle: "assets/app.js" }],
    });

    // The manifest is this build's, so it is declared, with no maps.
    expect(await collect()).toEqual([]);
    expect(warnings[0]).toContain("resolves outside");
  });

  it("skips a map it cannot read, and keeps the rest", async () => {
    // Every other check passed, so only the read itself can fail: its
    // permissions, or the file gone since it was listed. Never the publish.
    await writeFile(join(mapsDir, "assets", "vendor.js.map"), MAP);
    await givenManifest({
      version: 1,
      maps: [
        { file: "assets/app.js.map", bundle: "assets/app.js" },
        { file: "assets/vendor.js.map", bundle: "assets/vendor.js" },
      ],
    });
    unreadable.add(await realpath(join(mapsDir, "assets", "app.js.map")));

    const maps = await collect([
      asset("assets/app.js"),
      asset("assets/vendor.js"),
    ]);

    expect(maps?.map((m) => m.bundle)).toEqual(["assets/vendor.js"]);
    expect(warnings).toEqual([
      expect.stringContaining("assets/app.js.map: it could not be read"),
    ]);
  });

  it("declares nothing when its only map cannot be read", async () => {
    await givenManifest({
      version: 1,
      maps: [{ file: "assets/app.js.map", bundle: "assets/app.js" }],
    });
    unreadable.add(await realpath(join(mapsDir, "assets", "app.js.map")));

    // The manifest is this build's, so it is declared, with no maps.
    expect(await collect()).toEqual([]);
  });

  it("says once that a manifest names nothing this build emitted", async () => {
    // The folder sits outside the output, so a build's own clean leaves it:
    // a manifest from an earlier build is one warning, not one per entry.
    await givenManifest({
      version: 1,
      maps: ["a", "b", "c", "d"].map((name) => ({
        file: `assets/${name}-old.js.map`,
        bundle: `assets/${name}-old.js`,
      })),
    });

    expect(await collect()).toBeUndefined();
    expect(warnings).toEqual([
      expect.stringContaining("left from an earlier build"),
    ]);
    expect(warnings[0]).toContain("and 1 more");
  });

  it("counts the unmatched bundles in one warning beside the maps it keeps", async () => {
    await givenManifest({
      version: 1,
      maps: [
        { file: "assets/app.js.map", bundle: "assets/app.js" },
        { file: "assets/old.js.map", bundle: "assets/old.js" },
        { file: "assets/older.js.map", bundle: "assets/older.js" },
      ],
    });

    const maps = await collect();

    expect(maps?.map((m) => m.bundle)).toEqual(["assets/app.js"]);
    expect(warnings).toEqual([
      expect.stringContaining("Skipping 2 source maps"),
    ]);
  });

  it("declares a manifest with no maps as having none", async () => {
    // Written by the plugin on purpose: `[]` is "no maps", where no field at
    // all is "this mode was off".
    await givenManifest({ version: 1, maps: [] });

    expect(await collect()).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it.each([
    ["a parent segment", "assets/../../secret.txt"],
    ["an absolute path", "/etc/passwd"],
    ["a backslash", "assets\\app.js.map"],
    ["a drive", "C:/app.js.map"],
  ])("refuses a file with %s", async (_, file) => {
    await givenManifest({
      version: 1,
      maps: [{ file, bundle: "assets/app.js" }],
    });

    // The manifest is this build's, so it is declared, with no maps.
    expect(await collect()).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("refuses a bundle the build does not declare", async () => {
    await givenManifest({
      version: 1,
      maps: [{ file: "assets/app.js.map", bundle: "assets/app.js" }],
    });

    expect(await collect([asset("index.html")])).toBeUndefined();
    expect(warnings[0]).toContain("assets/app.js");
  });

  it("skips a manifest that is not an object of version 1", async () => {
    await givenManifest([{ file: "assets/app.js.map" }]);

    expect(await collect()).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});

describe("collectArtifacts, with private source maps", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "b44-maps-root-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("never declares a map as an asset, even from an output folder that holds them", async () => {
    // An output folder of "." walks the whole project, `.base44/` included.
    const mapsDir = join(projectRoot, ".base44", "source-maps");
    await mkdir(mapsDir, { recursive: true });
    await writeFile(join(projectRoot, "index.html"), "<h1>Hi</h1>\n");
    await writeFile(join(projectRoot, "app.js"), "1");
    await writeFile(join(mapsDir, "app.js.map"), MAP);
    await writeFile(
      join(mapsDir, "manifest.json"),
      JSON.stringify({
        version: 1,
        maps: [{ file: "app.js.map", bundle: "app.js" }],
      }),
    );

    const artifacts = await collectArtifacts({
      root: projectRoot,
      configDir: join(projectRoot, "base44"),
      buildCommand: "npm run build",
      outputDir: projectRoot,
      entitiesDir: "entities",
      agentsDir: "agents",
      agentSkillsDir: "agent-skills",
      functionsDir: "functions",
      actorsDir: "actors",
    });

    expect(artifacts.assets.map((a) => a.path)).toEqual([
      "app.js",
      "index.html",
    ]);
    expect(artifacts.sourceMaps?.map((m) => m.bundle)).toEqual(["app.js"]);
  });
});
