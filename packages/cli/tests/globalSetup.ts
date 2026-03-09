import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = join(__dirname, "..");

function getBinaryPath(): string {
  const platform =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "darwin"
        : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const ext = process.platform === "win32" ? ".exe" : "";
  return join(PKG_DIR, `dist/binaries/base44-${platform}-${arch}${ext}`);
}

export default function setup(): void {
  const binaryPath = getBinaryPath();
  if (!existsSync(binaryPath)) {
    console.log(
      "\n[globalSetup] Binary not found — running build + build:binaries...\n",
    );
    execSync("bun run build && bun run build:binaries", {
      cwd: PKG_DIR,
      stdio: "inherit",
    });
  }
}
