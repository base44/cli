import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAssetManifest, hashAsset } from "@/core/site/manifest.js";

describe("hashAsset", () => {
  it("computes the first 32 hex chars of sha256(utf8(app_id) || bytes)", () => {
    expect(hashAsset("test-app-id", Buffer.from("hello world"))).toBe(
      "b24ad526981fbac802de45c88c134ba4",
    );
  });

  it("matches a locally computed sha256 over the concatenated bytes", () => {
    const expected = createHash("sha256")
      .update(Buffer.concat([Buffer.from("app-1"), Buffer.from("content")]))
      .digest("hex")
      .slice(0, 32);
    expect(hashAsset("app-1", Buffer.from("content"))).toBe(expected);
  });

  it("salts with the app id so tenants can only collide with themselves", () => {
    const content = Buffer.from("hello world");
    expect(hashAsset("test-app-id", content)).not.toBe(
      hashAsset("other-app", content),
    );
  });
});

describe("buildAssetManifest", () => {
  let assetsDir: string;

  beforeEach(async () => {
    assetsDir = await mkdtemp(join(tmpdir(), "b44-assets-"));
  });

  afterEach(async () => {
    await rm(assetsDir, { recursive: true, force: true });
  });

  it("builds manifest keys as /-prefixed forward-slash paths with hash and size", async () => {
    await writeFile(join(assetsDir, "index.html"), "<h1>Hello</h1>\n");
    await mkdir(join(assetsDir, "assets"));
    await writeFile(join(assetsDir, "assets", "app.js"), "console.log(1);");

    const { manifest, filesByHash } = await buildAssetManifest(
      assetsDir,
      "test-app-id",
    );

    expect(Object.keys(manifest).sort()).toEqual([
      "/assets/app.js",
      "/index.html",
    ]);
    expect(manifest["/index.html"]).toEqual({
      hash: hashAsset("test-app-id", Buffer.from("<h1>Hello</h1>\n")),
      size: 15,
    });
    const entry = manifest["/assets/app.js"];
    expect(filesByHash.get(entry.hash)?.size).toBe(entry.size);
  });

  it("honors .assetsignore patterns (exact names, * globs, directory patterns)", async () => {
    await writeFile(
      join(assetsDir, ".assetsignore"),
      ["secret.txt", "*.log", "private/", "# a comment", ""].join("\n"),
    );
    await writeFile(join(assetsDir, "keep.txt"), "keep");
    await writeFile(join(assetsDir, "secret.txt"), "drop");
    await writeFile(join(assetsDir, "debug.log"), "drop");
    await mkdir(join(assetsDir, "private"));
    await writeFile(join(assetsDir, "private", "notes.txt"), "drop");
    await mkdir(join(assetsDir, "nested"));
    await writeFile(join(assetsDir, "nested", "secret.txt"), "drop");
    await writeFile(join(assetsDir, "nested", "keep.js"), "keep");

    const { manifest } = await buildAssetManifest(assetsDir, "test-app-id");

    expect(Object.keys(manifest).sort()).toEqual([
      "/keep.txt",
      "/nested/keep.js",
    ]);
  });

  it("honors .assetsignore negation", async () => {
    await writeFile(
      join(assetsDir, ".assetsignore"),
      [
        ".dev.vars*",
        "!.dev.vars.example",
        "secrets/",
        "!secrets/public.txt",
      ].join("\n"),
    );
    await writeFile(join(assetsDir, "index.html"), "hi");
    await writeFile(join(assetsDir, ".dev.vars.local"), "drop");
    await writeFile(join(assetsDir, ".dev.vars.example"), "keep");
    await mkdir(join(assetsDir, "secrets"));
    await writeFile(join(assetsDir, "secrets", "key.pem"), "drop");
    await writeFile(join(assetsDir, "secrets", "public.txt"), "drop");

    const { manifest } = await buildAssetManifest(assetsDir, "test-app-id");

    // `!secrets/public.txt` does not rescue: git cannot re-include a file
    // under an excluded directory.
    expect(Object.keys(manifest).sort()).toEqual([
      "/.dev.vars.example",
      "/index.html",
    ]);
  });

  it("treats braces and extglobs as literal names, like gitignore", async () => {
    await writeFile(
      join(assetsDir, ".assetsignore"),
      ["{foo,bar}.js", "+(baz|qux).js"].join("\n"),
    );
    await writeFile(join(assetsDir, "foo.js"), "keep");
    await writeFile(join(assetsDir, "baz.js"), "keep");
    await writeFile(join(assetsDir, "{foo,bar}.js"), "drop");

    const { manifest } = await buildAssetManifest(assetsDir, "test-app-id");

    expect(Object.keys(manifest).sort()).toEqual(["/baz.js", "/foo.js"]);
  });

  it("anchors .assetsignore patterns that contain a slash", async () => {
    await writeFile(
      join(assetsDir, ".assetsignore"),
      ["/root-only.txt", "nested/drop.txt", "**/*.map"].join("\n"),
    );
    await writeFile(join(assetsDir, "root-only.txt"), "drop");
    await mkdir(join(assetsDir, "nested", "root-only.txt"), {
      recursive: true,
    });
    await writeFile(join(assetsDir, "nested", "root-only.txt", "keep"), "keep");
    await writeFile(join(assetsDir, "nested", "drop.txt"), "drop");
    await writeFile(join(assetsDir, "nested", "keep.txt"), "keep");
    await writeFile(join(assetsDir, "app.js.map"), "drop");
    await writeFile(join(assetsDir, "nested", "app.js.map"), "drop");

    const { manifest } = await buildAssetManifest(assetsDir, "test-app-id");

    expect(Object.keys(manifest).sort()).toEqual([
      "/nested/keep.txt",
      "/nested/root-only.txt/keep",
    ]);
  });

  it("includes dotfiles that are not ignored", async () => {
    await mkdir(join(assetsDir, ".well-known"));
    await writeFile(join(assetsDir, ".well-known", "security.txt"), "contact");

    const { manifest } = await buildAssetManifest(assetsDir, "test-app-id");

    expect(Object.keys(manifest)).toEqual(["/.well-known/security.txt"]);
  });

  it("always skips .assetsignore, wrangler.json, and .dev.vars", async () => {
    await writeFile(join(assetsDir, "index.html"), "hi");
    await writeFile(join(assetsDir, "wrangler.json"), "{}");
    await writeFile(join(assetsDir, ".dev.vars"), "SECRET=1");

    const { manifest } = await buildAssetManifest(assetsDir, "test-app-id");

    expect(Object.keys(manifest)).toEqual(["/index.html"]);
  });

  it("rejects files larger than 25 MiB with a per-file error", async () => {
    const bigFile = join(assetsDir, "big.bin");
    await writeFile(bigFile, "");
    await truncate(bigFile, 25 * 1024 * 1024 + 1);

    await expect(buildAssetManifest(assetsDir, "test-app-id")).rejects.toThrow(
      /"big\.bin".*exceeds the 25 MiB per-file limit/,
    );
  });

  it("dedupes identical files by hash in filesByHash", async () => {
    await writeFile(join(assetsDir, "a.txt"), "same");
    await writeFile(join(assetsDir, "b.txt"), "same");

    const { manifest, filesByHash } = await buildAssetManifest(
      assetsDir,
      "test-app-id",
    );

    expect(Object.keys(manifest)).toHaveLength(2);
    expect(manifest["/a.txt"].hash).toBe(manifest["/b.txt"].hash);
    expect(filesByHash.size).toBe(1);
  });
});
