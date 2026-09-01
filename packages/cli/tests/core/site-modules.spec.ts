import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectModules } from "@/core/site/modules.js";
import type { ResolvedWranglerConfig } from "@/core/site/wrangler-config.js";

describe("collectModules", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "b44-modules-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  function makeConfig(
    overrides: Partial<ResolvedWranglerConfig> = {},
  ): ResolvedWranglerConfig {
    return {
      configPath: join(configDir, "wrangler.json"),
      configDir,
      main: "index.js",
      assetsDirectory: null,
      assetsConfig: null,
      compatibilityDate: null,
      compatibilityFlags: [],
      rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
      uploadSourceMaps: false,
      ...overrides,
    };
  }

  it("collects the entry first plus rules glob matches, preserving relative names", async () => {
    await writeFile(join(configDir, "index.js"), "export default {};");
    await mkdir(join(configDir, "assets"));
    await writeFile(join(configDir, "assets", "chunk.js"), "export {};");
    await writeFile(join(configDir, "helper.mjs"), "export {};");
    await writeFile(join(configDir, "readme.txt"), "not a module");

    const modules = await collectModules(makeConfig());

    expect(modules[0].name).toBe("index.js");
    expect(modules[0].type).toBe("esm");
    expect(modules.map((m) => m.name).sort()).toEqual([
      "assets/chunk.js",
      "helper.mjs",
      "index.js",
    ]);
    expect(modules.every((m) => m.size > 0)).toBe(true);
  });

  it("excludes wrangler.json and .dev.vars", async () => {
    await writeFile(join(configDir, "index.js"), "export default {};");
    await writeFile(join(configDir, "wrangler.json"), "{}");
    await writeFile(join(configDir, ".dev.vars"), "SECRET=1");

    const modules = await collectModules(makeConfig());

    expect(modules.map((m) => m.name)).toEqual(["index.js"]);
  });

  it("includes .map files next to modules as sourcemap modules", async () => {
    await writeFile(join(configDir, "index.js"), "export default {};");
    await writeFile(join(configDir, "index.js.map"), "{}");
    await writeFile(join(configDir, "orphan.map"), "{}");

    const modules = await collectModules(makeConfig());

    const map = modules.find((m) => m.name === "index.js.map");
    expect(map?.type).toBe("sourcemap");
    // orphan.map is not adjacent to any module and upload_source_maps is off
    expect(modules.find((m) => m.name === "orphan.map")).toBeUndefined();
  });

  it("includes all .map files when upload_source_maps is set", async () => {
    await writeFile(join(configDir, "index.js"), "export default {};");
    await writeFile(join(configDir, "orphan.map"), "{}");

    const modules = await collectModules(
      makeConfig({ uploadSourceMaps: true }),
    );

    expect(modules.find((m) => m.name === "orphan.map")?.type).toBe(
      "sourcemap",
    );
  });

  it("skips modules under the assets directory when it is inside the config dir", async () => {
    await writeFile(join(configDir, "index.js"), "export default {};");
    await mkdir(join(configDir, "client"));
    await writeFile(join(configDir, "client", "app.js"), "console.log(1);");

    const modules = await collectModules(
      makeConfig({ assetsDirectory: join(configDir, "client") }),
    );

    expect(modules.map((m) => m.name)).toEqual(["index.js"]);
  });

  it("fails when the entry module does not exist", async () => {
    await expect(collectModules(makeConfig())).rejects.toThrow(
      /entry module does not exist/,
    );
  });

  it("fails on unknown rule types", async () => {
    await writeFile(join(configDir, "index.js"), "export default {};");

    await expect(
      collectModules(
        makeConfig({ rules: [{ type: "CommonJS", globs: ["**/*.cjs"] }] }),
      ),
    ).rejects.toThrow(/Unsupported module rule type "CommonJS"/);
  });

  it("enforces the 40 MB total module payload limit", async () => {
    await writeFile(join(configDir, "index.js"), "export default {};");
    const bigModule = join(configDir, "big.js");
    await writeFile(bigModule, "");
    await truncate(bigModule, 40 * 1024 * 1024 + 1);

    await expect(collectModules(makeConfig())).rejects.toThrow(
      /exceeds the 40 MB limit/,
    );
  });
});
