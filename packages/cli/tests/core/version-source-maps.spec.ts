import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectArtifacts } from "@/core/version/artifacts.js";
import type { ArtifactFile } from "@/core/version/schema.js";
import { collectSourceMaps } from "@/core/version/source-maps.js";

const MAP = '{"version":3,"mappings":"AAAA"}';

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
        absolutePath: join(mapsDir, "assets", "app.js.map"),
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

    expect(await collect()).toBeUndefined();
    expect(warnings).toHaveLength(1);
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

    expect(await collect()).toBeUndefined();
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
