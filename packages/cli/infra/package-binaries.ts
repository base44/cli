/**
 * Package compiled binaries into release archives.
 *
 * Prerequisites: run `bun run build:binaries` first so that dist/binaries/ has raw executables.
 *
 * Steps:
 *   1. Wrap each binary + README.md in a .tar.gz archive
 *   2. Delete the raw binary
 */
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";

const TARGETS = [
  { target: "bun-darwin-arm64", output: "base44-darwin-arm64" },
  { target: "bun-darwin-x64", output: "base44-darwin-x64" },
  { target: "bun-linux-x64", output: "base44-linux-x64" },
  { target: "bun-linux-arm64", output: "base44-linux-arm64" },
  { target: "bun-windows-x64", output: "base44-windows-x64.exe" },
] as const;

const ROOT = join(import.meta.dir, "..");
const BINARIES_DIR = join(ROOT, "dist", "binaries");

// ---------------------------------------------------------------------------
// Verify prerequisites
// ---------------------------------------------------------------------------
for (const { output } of TARGETS) {
  if (!existsSync(join(BINARIES_DIR, output))) {
    console.error(
      chalk.red(
        `\n✗ Missing dist/binaries/${output} — run \`bun run build:binaries\` first.\n`,
      ),
    );
    process.exit(1);
  }
}

const readme = readFileSync(join(ROOT, "README.md"));

// ---------------------------------------------------------------------------
// 1. Archive each binary with README.md
// ---------------------------------------------------------------------------
console.log(chalk.dim("\n  Packaging archives..."));

for (const { output } of TARGETS) {
  const binaryPath = join(BINARIES_DIR, output);
  const archiveName = `${output.replace(/\.exe$/, "")}.tar.gz`;
  const archivePath = join(BINARIES_DIR, archiveName);
  const entryName = output.includes("windows") ? "base44.exe" : "base44";

  console.log(chalk.dim(`  ${archiveName}...`));
  const content = readFileSync(binaryPath);
  const archive = new Bun.Archive(
    { [entryName]: content, "README.md": readme },
    { compress: "gzip" },
  );
  await Bun.write(archivePath, archive);
  unlinkSync(binaryPath);
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------
console.log(chalk.green.bold("\n✓ Archives packaged\n"));
console.log(chalk.dim("  Output:"));
for (const { output } of TARGETS) {
  const archiveName = `${output.replace(/\.exe$/, "")}.tar.gz`;
  const archivePath = join(BINARIES_DIR, archiveName);
  const sizeMB = (Bun.file(archivePath).size / 1024 / 1024).toFixed(1);
  console.log(
    `  ${chalk.cyan(archivePath)} ${chalk.dim(`(${sizeMB} MB)`)}`,
  );
}
