import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveFullStackBuild } from "@/core/site/full-stack.js";

describe("resolveFullStackBuild", () => {
  let projectRoot: string;
  let distDir: string;

  async function writeBuild(config: Record<string, unknown> = {}) {
    await mkdir(join(distDir, "client"), { recursive: true });
    await writeFile(join(distDir, "client", "index.html"), "<h1>Hi</h1>\n");
    await writeFile(join(distDir, "index.js"), "export default {};");
    await writeFile(
      join(distDir, "wrangler.json"),
      JSON.stringify({
        main: "index.js",
        no_bundle: true,
        rules: [{ type: "ESModule", globs: ["**/*.js"] }],
        assets: { directory: "./client" },
        ...config,
      }),
    );
    await mkdir(join(projectRoot, ".wrangler", "deploy"), { recursive: true });
    await writeFile(
      join(projectRoot, ".wrangler", "deploy", "config.json"),
      JSON.stringify({ configPath: "../../dist/wrangler.json" }),
    );
  }

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "b44-fs-"));
    distDir = join(projectRoot, "dist");
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("reports nothing for a project that built a plain static site", async () => {
    expect(await resolveFullStackBuild(projectRoot)).toBeNull();
  });

  it("answers with the config, the modules and the assets directory", async () => {
    await writeBuild();

    const built = await resolveFullStackBuild(projectRoot);

    expect(built?.config.main).toBe("index.js");
    expect(built?.modules.map((m) => m.name)).toEqual(["index.js"]);
    expect(built?.assetsDir).toBe(join(distDir, "client"));
  });

  it("reports no assets directory when the config declares none", async () => {
    await writeBuild({ assets: undefined });

    expect((await resolveFullStackBuild(projectRoot))?.assetsDir).toBeNull();
  });

  it("reports no assets directory when the build produced none", async () => {
    // Declared but absent: the Worker answers every path itself, which is a
    // complete app — not a build to refuse.
    await writeBuild({ assets: { directory: "./nothing-here" } });

    expect((await resolveFullStackBuild(projectRoot))?.assetsDir).toBeNull();
  });
});
