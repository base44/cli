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
