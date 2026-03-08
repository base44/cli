/**
 * Build standalone binaries for Homebrew / direct download distribution.
 *
 * Prerequisites: run `bun run build` first so that dist/cli/ and dist/assets/ exist.
 *
 * Steps:
 *   1. Create dist/assets.tar.gz from dist/assets/ (templates + deno-runtime)
 *   2. Cross-compile for each platform with `bun build --compile`
 *
 * After this, run `bun run package:binaries` to archive and checksum.
 */
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import chalk from "chalk";

function collectFiles(
  dir: string,
  rootPrefix: string,
  out: Record<string, Uint8Array> = {},
): Record<string, Uint8Array> {
  function walk(currentDir: string, prefix: string) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = join(currentDir, entry.name);
      const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, archivePath);
      } else {
        out[archivePath] = readFileSync(fullPath);
      }
    }
  }
  walk(dir, rootPrefix);
  return out;
}

const TARGETS = [
  { target: "bun-darwin-arm64", output: "base44-darwin-arm64" },
  { target: "bun-darwin-x64", output: "base44-darwin-x64" },
  { target: "bun-linux-x64", output: "base44-linux-x64" },
  { target: "bun-linux-arm64", output: "base44-linux-arm64" },
  { target: "bun-windows-x64", output: "base44-windows-x64.exe" },
] as const;

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const BINARIES_DIR = join(DIST, "binaries");
const ENTRY = join(ROOT, "bin", "binary-entry.ts");
const WINDOWS_ICON = join(ROOT, "infra", "base44.ico");

// ---------------------------------------------------------------------------
// Verify prerequisites
// ---------------------------------------------------------------------------
for (const required of [
  "dist/cli/index.js",
  "dist/assets/templates/templates.json",
  "dist/assets/deno-runtime/main.js",
]) {
  if (!existsSync(join(ROOT, required))) {
    console.error(
      chalk.red(`\n✗ Missing ${required} — run \`bun run build\` first.\n`),
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 1. Create unified assets tarball from dist/assets/
// ---------------------------------------------------------------------------
console.log(chalk.dim("  Creating assets.tar.gz..."));
const tarball = join(DIST, "assets.tar.gz");
const files: Record<string, Uint8Array> = {};
collectFiles(join(DIST, "assets"), "", files);
const archive = new Bun.Archive(files, { compress: "gzip" });
await Bun.write(tarball, archive);

// ---------------------------------------------------------------------------
// 2. Compile binaries
// ---------------------------------------------------------------------------
mkdirSync(BINARIES_DIR, { recursive: true });

for (const { target, output } of TARGETS) {
  const outPath = join(BINARIES_DIR, output);
  console.log(chalk.dim(`  Compiling ${output}...`));

  const args = [
    "bun",
    "build",
    "--compile",
    `--target=${target}`,
    ENTRY,
    "--outfile",
    outPath,
  ];

  // --windows-icon is only supported when the build host is Windows
  if (target.includes("windows") && process.platform === "win32") {
    args.push(`--windows-icon=${WINDOWS_ICON}`);
  }

  const result = Bun.spawnSync(args, { cwd: ROOT });

  if (!result.success) {
    console.error(chalk.red(`\n✗ Failed to compile ${output}\n`));
    console.error(result.stderr.toString());
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------
console.log(chalk.green.bold("\n✓ Binaries compiled\n"));
console.log(chalk.dim("  Output:"));
for (const { output } of TARGETS) {
  const filePath = join(BINARIES_DIR, output);
  const sizeMB = (Bun.file(filePath).size / 1024 / 1024).toFixed(1);
  console.log(`  ${chalk.cyan(filePath)} ${chalk.dim(`(${sizeMB} MB)`)}`);
}
