/**
 * Entry point for standalone compiled binaries (built with `bun build --compile`).
 *
 * This file embeds assets (templates, deno-runtime wrapper) into the binary
 * and extracts them to ~/.base44/assets/<version>/ on first run.
 * The npm distribution uses bin/run.js instead — this file is only used
 * for the compiled binary path.
 */
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { extract } from "tar";
// @ts-expect-error -- import attributes with type "file" are a Bun-specific feature
import denoWrapper from "../../dist/deno-runtime/main.js" with { type: "file" };
// Bun embeds these files into the compiled binary.
// At runtime, each resolves to a path inside the $bunfs virtual filesystem.
// Only Bun.file() can read these paths — Node.js fs APIs and external
// processes cannot access them directly.
// @ts-expect-error -- import attributes with type "file" are a Bun-specific feature
import templatesTarball from "../../dist/templates.tar.gz" with {
  type: "file",
};
import packageJson from "../../package.json";

const VERSION = packageJson.version;

const assetsDir = join(homedir(), ".base44", "assets", VERSION);
const templatesDir = join(assetsDir, "templates");
const denoWrapperDir = join(assetsDir, "deno-runtime");
const denoWrapperPath = join(denoWrapperDir, "main.js");

// Extract assets if this version hasn't been unpacked yet.
// Bun.file() reads from the virtual $bunfs, then we write to real disk
// so the rest of the CLI can access these files normally.
if (!existsSync(templatesDir)) {
  mkdirSync(templatesDir, { recursive: true });
  // Copy tarball from $bunfs to a real temp file, then extract
  const tmpTarball = join(tmpdir(), `base44-templates-${VERSION}.tar.gz`);
  await Bun.write(tmpTarball, Bun.file(templatesTarball));
  await pipeline(createReadStream(tmpTarball), extract({ cwd: templatesDir }));
}

if (!existsSync(denoWrapperPath)) {
  mkdirSync(denoWrapperDir, { recursive: true });
  await Bun.write(denoWrapperPath, Bun.file(denoWrapper));
}

// Set global overrides so core modules resolve to the extracted paths
// instead of the (non-existent) __dirname-relative paths.
globalThis.__BASE44_TEMPLATES_DIR = templatesDir;
globalThis.__BASE44_DENO_WRAPPER_PATH = denoWrapperPath;

// Disable Clack spinners and animations in non-interactive environments.
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.env.CI = "true";
}

const { runCLI } = await import("./index.js");
await runCLI();
