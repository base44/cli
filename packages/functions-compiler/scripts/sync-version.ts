// Rewrites the COMPILER_VERSION literal in src/version.ts to match package.json.
//
// The version has to be a literal (see src/version.ts for why), so a release
// edits two files. `npm version` only knows about one of them, and a stale
// literal is invisible: the build succeeds, the publish succeeds, and every
// compiled shard's banner then claims a version that was never published.
// version.test.ts catches the drift, but only after the fact — this closes it.
//
//   bun run scripts/sync-version.ts

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const versionFilePath = fileURLToPath(new URL("../src/version.ts", import.meta.url));

const { version } = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };
if (!version) throw new Error("package.json has no version");

const source = readFileSync(versionFilePath, "utf8");
const literal = /^export const COMPILER_VERSION = "(.*)";$/m;

const match = source.match(literal);
if (!match) {
  // A silent no-op here would ship the exact drift this script exists to stop.
  throw new Error(`no COMPILER_VERSION literal found in ${versionFilePath}`);
}

if (match[1] === version) {
  console.log(`COMPILER_VERSION already ${version}`);
} else {
  writeFileSync(versionFilePath, source.replace(literal, `export const COMPILER_VERSION = "${version}";`));
  console.log(`COMPILER_VERSION ${match[1]} -> ${version}`);
}
