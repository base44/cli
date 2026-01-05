import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

export function getPackageVersion(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // From cli/dist/utils -> package.json at root
  // __dirname is cli/dist/utils, so: .. -> cli/dist, .. -> cli, then package.json
  const packageJsonPath = join(__dirname, "..", "..", "..", "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  return packageJson.version;
}

