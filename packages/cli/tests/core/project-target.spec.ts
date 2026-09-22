import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SchemaValidationError } from "@/core/errors.js";
import { requireOutputDir, resolveBuildTarget } from "@/core/project/target.js";

describe("resolveBuildTarget", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "b44-project-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeConfig(config: unknown): Promise<void> {
    await mkdir(join(root, "base44"), { recursive: true });
    await writeFile(
      join(root, "base44", "config.jsonc"),
      JSON.stringify(config),
    );
  }

  it("supplies a Builder repo's missing defaults", async () => {
    // Builder repos carry no CLI config at all, and `base44 build` used to throw
    // ConfigNotFoundError on one.
    const target = await resolveBuildTarget(root);

    expect(target).toEqual({
      root,
      configDir: join(root, "base44"),
      buildCommand: "npm run build",
      outputDir: resolve(root, "dist"),
      entitiesDir: "entities",
      agentsDir: "agents",
    });
  });

  it("does not guess for a config that is present and omits a field", async () => {
    // Omitting one is a deliberate statement, and every project that relies on
    // the existing error still gets it. Only a wholly absent config is defaulted.
    await writeConfig({ name: "my-app" });

    const target = await resolveBuildTarget(root, { outputDir: "dist" });

    expect(target.buildCommand).toBeUndefined();
  });

  it("names no output directory when a present config names none", async () => {
    // Reported at the point of collection, not here: a project missing both is
    // told about its build command first, which is the one it hits first.
    await writeConfig({
      name: "my-app",
      site: { buildCommand: "npm run build" },
    });

    const target = await resolveBuildTarget(root);

    expect(target.outputDir).toBeNull();
    expect(() => requireOutputDir(target)).toThrow(
      /No site configuration found/,
    );
  });

  it("writes nothing", async () => {
    // The sandbox used to overwrite base44/config.jsonc with a minimal one,
    // destroying any checked-in configuration — and, for a full-stack app, its
    // build command.
    await resolveBuildTarget(root);

    expect(await readdir(root)).toEqual([]);
  });

  it("leaves a checked-in config exactly as it was", async () => {
    const config = {
      name: "my-app",
      site: { buildCommand: "pnpm build", outputDirectory: "build" },
    };
    await writeConfig(config);
    const before = await readFile(join(root, "base44", "config.jsonc"), "utf8");

    const target = await resolveBuildTarget(root);

    expect(await readFile(join(root, "base44", "config.jsonc"), "utf8")).toBe(
      before,
    );
    expect(target.buildCommand).toBe("pnpm build");
    expect(target.outputDir).toBe(resolve(root, "build"));
  });

  it("honors an explicit output directory over both", async () => {
    await writeConfig({ name: "my-app", site: { outputDirectory: "out" } });

    const target = await resolveBuildTarget(root, { outputDir: "elsewhere" });

    expect(target.outputDir).toBe(resolve(root, "elsewhere"));
  });

  it("still fails on a config that is present and invalid", async () => {
    // Only a MISSING config is defaulted. Publishing past a broken one is how a
    // typo becomes a version built the wrong way.
    await writeConfig({ site: { buildCommand: 42 } });

    await expect(resolveBuildTarget(root)).rejects.toBeInstanceOf(
      SchemaValidationError,
    );
  });
});
