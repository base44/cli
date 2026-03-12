/**
 * Entry point for standalone compiled binaries (built with `bun build --compile`).
 *
 * This file embeds a single assets tarball (templates + deno-runtime) into the
 * binary and extracts it to ~/.base44/assets/<version>/ on first run.
 * The npm distribution uses bin/run.js instead — this file is only used
 * for the compiled binary path.
 */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runCLI } from "../src/cli/index.js";
// Bun embeds this file into the compiled binary.
// At runtime, it resolves to a path inside the $bunfs virtual filesystem.
// Only Bun.file() can read these paths — Node.js fs APIs and external
// processes cannot access them directly.
// @ts-expect-error -- import attributes with type "file" are a Bun-specific feature
import assetsTarball from "../dist/assets.tar.gz" with { type: "file" };
import packageJson from "../package.json";

const VERSION = packageJson.version;

const assetsDir = join(homedir(), ".base44", "assets", VERSION);

// Extract assets if this version hasn't been unpacked yet.
// Bun.file() reads from the virtual $bunfs, then we write to real disk
// so the rest of the CLI can access these files normally.
if (!existsSync(assetsDir)) {
  mkdirSync(assetsDir, { recursive: true });
  const bytes = await Bun.file(assetsTarball).bytes();
  const archive = new Bun.Archive(bytes);
  await archive.extract(assetsDir);
}

// Disable Clack spinners and animations in non-interactive environments.
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.env.CI = "true";
}

await runCLI({ distribution: "binary" });
