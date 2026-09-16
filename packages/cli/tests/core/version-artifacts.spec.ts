import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidInputError } from "@/core/errors.js";
import { hashAsset } from "@/core/site/manifest.js";
import {
  collectBuildOutput,
  collectResources,
  collectSiteWorker,
} from "@/core/version/artifacts.js";

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

describe("collectBuildOutput", () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), "b44-build-"));
    await writeFile(join(outputDir, "index.html"), "<h1>Hello</h1>\n");
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it("names each file by a full sha256 over its bytes", async () => {
    const files = await collectBuildOutput(outputDir);

    expect(files).toEqual([
      {
        path: "index.html",
        absolutePath: join(outputDir, "index.html"),
        size: 15,
        digest: sha256("<h1>Hello</h1>\n"),
      },
    ]);
  });

  it("is not the provider asset hash, which is salted and truncated", async () => {
    // Conflating the two produces a file that uploads fine and never dedupes,
    // or a digest check that fails on a correct file.
    const [file] = await collectBuildOutput(outputDir);

    expect(file.digest).not.toContain(
      hashAsset("app-1", Buffer.from("<h1>Hello</h1>\n")),
    );
    expect(file.digest.replace("sha256:", "")).toHaveLength(64);
  });

  it("keys nested files by forward-slash paths with no leading slash", async () => {
    // The platform turns each path into a key under the frontend's prefix, and
    // refuses a leading slash outright.
    await mkdir(join(outputDir, "assets"));
    await writeFile(join(outputDir, "assets", "app.js"), "console.log(1);");

    const paths = (await collectBuildOutput(outputDir)).map((f) => f.path);

    expect(paths).toEqual(["assets/app.js", "index.html"]);
  });

  it("honors .assetsignore", async () => {
    await writeFile(join(outputDir, ".assetsignore"), "*.map\n");
    await writeFile(join(outputDir, "app.js.map"), "{}");

    const paths = (await collectBuildOutput(outputDir)).map((f) => f.path);

    expect(paths).toEqual(["index.html"]);
  });

  it("hashes a large set without exhausting file descriptors", async () => {
    // An unbounded Promise.all opens one descriptor per file and dies with
    // EMFILE around 1.5k on a default limit — well under the 100k this
    // advertises. 1200 is enough to fail the unbounded version reliably.
    // Written sequentially: the point under test is the COLLECTOR's fan-out,
    // so the fixture must not be what runs out of descriptors.
    await mkdir(join(outputDir, "many"));
    for (let i = 0; i < 1200; i++) {
      await writeFile(
        join(outputDir, "many", `f${i}.js`),
        `export const x = ${i};`,
      );
    }

    const files = await collectBuildOutput(outputDir);

    expect(files).toHaveLength(1201);
    expect(new Set(files.map((f) => f.digest)).size).toBe(1201);
  }, 30_000);

  it("refuses a set with no entry point", async () => {
    await rm(join(outputDir, "index.html"));
    await writeFile(join(outputDir, "app.js"), "console.log(1);");

    await expect(collectBuildOutput(outputDir)).rejects.toThrow(
      /no index\.html/,
    );
  });

  it("refuses an empty output directory", async () => {
    await rm(join(outputDir, "index.html"));

    await expect(collectBuildOutput(outputDir)).rejects.toBeInstanceOf(
      InvalidInputError,
    );
  });
});

describe("collectResources", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "b44-config-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  const dirs = { entitiesDir: "entities", agentsDir: "agents" };

  it("keys a payload by its path with the schema extension stripped", async () => {
    // The same name the platform derives from the same file, so a version made
    // here and one made in-process describe the same entity.
    await mkdir(join(configDir, "entities"));
    await writeFile(
      join(configDir, "entities", "Todo.jsonc"),
      '{ "name": "Todo", "type": "object" }',
    );
    await mkdir(join(configDir, "agents", "support"), { recursive: true });
    await writeFile(join(configDir, "agents", "support", "triage.json"), "{}");

    const { entities, agents } = await collectResources(configDir, dirs);

    expect(entities).toEqual({ Todo: { name: "Todo", type: "object" } });
    expect(agents).toEqual({ "support/triage": {} });
  });

  it("sends the payload raw, without the CLI's stricter validation", async () => {
    // The platform's extractor and validation are authoritative. Applying the
    // CLI's entity schema here is exactly what blocks real Builder apps, which
    // is why `site deploy` reads no resources at all.
    await mkdir(join(configDir, "entities"));
    await writeFile(
      join(configDir, "entities", "Odd.jsonc"),
      '{ "no_name_field": true, "properties": { "x": { "type": "whatever" } } }',
    );

    const { entities } = await collectResources(configDir, dirs);

    expect(entities).toEqual({
      Odd: { no_name_field: true, properties: { x: { type: "whatever" } } },
    });
  });

  it("reads an app that declares none as declaring none", async () => {
    expect(await collectResources(configDir, dirs)).toEqual({
      entities: {},
      agents: {},
    });
  });
});

describe("collectSiteWorker", () => {
  let projectRoot: string;
  let distDir: string;

  async function writeFullStackBuild(
    config: Record<string, unknown> = {},
  ): Promise<void> {
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
    projectRoot = await mkdtemp(join(tmpdir(), "b44-fullstack-"));
    distDir = join(projectRoot, "dist");
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("reports no worker for an app that has no server of its own", async () => {
    // Almost every app: there is no redirect file, so there is nothing to read.
    expect(await collectSiteWorker(projectRoot)).toBeNull();
  });

  it("describes each module the same way it describes a frontend file", async () => {
    await writeFullStackBuild();

    const worker = await collectSiteWorker(projectRoot);

    expect(worker?.modules).toEqual([
      {
        path: "index.js",
        absolutePath: join(distDir, "index.js"),
        size: 18,
        digest: sha256("export default {};"),
      },
    ]);
  });

  it("names the entry as the module set names it, not as the config wrote it", async () => {
    // The platform matches `main` against the module names it was sent, so a
    // "./" that survived would name a module nothing in the set provides.
    await writeFullStackBuild({ main: "./index.js" });

    const worker = await collectSiteWorker(projectRoot);

    expect(worker?.main).toBe("index.js");
  });

  it("carries the settings the modules were built for", async () => {
    await writeFullStackBuild({
      compatibility_date: "2026-01-01",
      compatibility_flags: ["nodejs_compat"],
    });

    const worker = await collectSiteWorker(projectRoot);

    expect(worker?.compatibilityDate).toBe("2026-01-01");
    expect(worker?.compatibilityFlags).toEqual(["nodejs_compat"]);
  });

  it("points the frontend at the worker's own assets directory", async () => {
    // Not the project's `site.outputDirectory`: a full-stack build puts the
    // frontend where the Worker serves it from.
    await writeFullStackBuild();

    const worker = await collectSiteWorker(projectRoot);

    expect(worker?.assetsDir).toBe(join(distDir, "client"));
    expect(await collectBuildOutput(worker?.assetsDir as string)).toHaveLength(
      1,
    );
  });

  it("leaves the assets out of the module set", async () => {
    // They are declared as the frontend. Declared twice, they would upload
    // twice and land in two different prefixes.
    await writeFullStackBuild();
    await writeFile(join(distDir, "client", "app.js"), "console.log(1);");

    const worker = await collectSiteWorker(projectRoot);

    expect(worker?.modules.map((m) => m.path)).toEqual(["index.js"]);
  });
});
