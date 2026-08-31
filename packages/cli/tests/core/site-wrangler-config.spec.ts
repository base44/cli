import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectFullStackArtifact,
  resolveWranglerConfig,
} from "@/core/site/wrangler-config.js";

const FIXTURES_DIR = resolve(__dirname, "../fixtures");

const BASE_CONFIG = {
  name: "test-worker",
  main: "index.js",
  no_bundle: true,
  rules: [{ type: "ESModule", globs: ["**/*.js"] }],
  compatibility_date: "2025-04-01",
};

describe("wrangler config resolution", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "b44-wrangler-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeRedirect(configPath: string): Promise<void> {
    await mkdir(join(root, ".wrangler", "deploy"), { recursive: true });
    await writeFile(
      join(root, ".wrangler", "deploy", "config.json"),
      JSON.stringify({ configPath, auxiliaryWorkers: [] }),
    );
  }

  /** A complete build artifact: the redirect file plus the config it names. */
  async function writeArtifact(config: object): Promise<void> {
    await writeRedirect("../../out/wrangler.json");
    await mkdir(join(root, "out"), { recursive: true });
    await writeFile(join(root, "out", "wrangler.json"), JSON.stringify(config));
  }

  it("resolves the config through the redirect file (path relative to the redirect dir)", async () => {
    await writeRedirect("../../dist/worker/wrangler.json");
    await mkdir(join(root, "dist", "worker"), { recursive: true });
    await writeFile(
      join(root, "dist", "worker", "wrangler.json"),
      JSON.stringify({
        ...BASE_CONFIG,
        assets: { directory: "../client" },
        vars: { FOO: "bar" },
        compatibility_flags: ["nodejs_compat"],
      }),
    );

    const config = await resolveWranglerConfig(root);

    expect(config.configDir).toBe(join(root, "dist", "worker"));
    expect(config.main).toBe("index.js");
    expect(config.assetsDirectory).toBe(join(root, "dist", "client"));
    expect(config.compatibilityDate).toBe("2025-04-01");
    expect(config.compatibilityFlags).toEqual(["nodejs_compat"]);
    expect(config.vars).toEqual({ FOO: "bar" });
    expect(config.rules).toEqual([{ type: "ESModule", globs: ["**/*.js"] }]);
  });

  it("resolves the fullstack-project fixture", async () => {
    const config = await resolveWranglerConfig(
      resolve(FIXTURES_DIR, "fullstack-project"),
    );

    expect(config.main).toBe("index.js");
    expect(config.assetsDirectory).toBe(
      resolve(FIXTURES_DIR, "fullstack-project", "build", "client"),
    );
  });

  it("ignores extra redirect-file fields like prerenderWorkerConfigPath (Astro 6)", async () => {
    await mkdir(join(root, ".wrangler", "deploy"), { recursive: true });
    await writeFile(
      join(root, ".wrangler", "deploy", "config.json"),
      JSON.stringify({
        configPath: "../../out/wrangler.json",
        auxiliaryWorkers: [],
        prerenderWorkerConfigPath: "../../out/prerender/wrangler.json",
      }),
    );
    await mkdir(join(root, "out"), { recursive: true });
    await writeFile(
      join(root, "out", "wrangler.json"),
      JSON.stringify(BASE_CONFIG),
    );

    const config = await resolveWranglerConfig(root);

    expect(config.configDir).toBe(join(root, "out"));
    expect(config.main).toBe("index.js");
  });

  it("fails clearly when the config lacks no_bundle: true", async () => {
    await writeArtifact({ ...BASE_CONFIG, no_bundle: undefined });

    await expect(resolveWranglerConfig(root)).rejects.toThrow(
      /requires bundling; not yet supported/,
    );
  });

  it("ignores bindings instead of failing on them", async () => {
    await writeArtifact({
      ...BASE_CONFIG,
      vars: { A: "1" },
      kv_namespaces: [{ binding: "KV", id: "abc" }],
      durable_objects: { bindings: [{ name: "DO", class_name: "Foo" }] },
      queues: { producers: [{ binding: "Q", queue: "q" }], consumers: [] },
    });

    const config = await resolveWranglerConfig(root);
    expect(config.main).toBe("index.js");
    expect(config.vars).toEqual({ A: "1" });
  });

  it("detects nothing in a plain project", async () => {
    expect(await detectFullStackArtifact(root)).toBeNull();
  });

  it("does not treat a hand-authored root wrangler config as an artifact", async () => {
    // Detecting one would hijack the deploy away from the static upload.
    await writeFile(join(root, "wrangler.jsonc"), JSON.stringify(BASE_CONFIG));
    await writeFile(join(root, "wrangler.json"), JSON.stringify(BASE_CONFIG));
    await writeFile(join(root, "wrangler.toml"), 'name = "test-worker"\n');

    expect(await detectFullStackArtifact(root)).toBeNull();
    await expect(resolveWranglerConfig(root)).rejects.toThrow(
      /No Workers build artifact found/,
    );
  });
});
