#!/usr/bin/env node
// Keep this file free of syntax newer than Node 12 can parse (no top-level
// await, no static import of the bundle), so users on unsupported Node
// versions get the clear version error below instead of a SyntaxError.
import { readFileSync } from "fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
);
const requiredVersion = packageJson.engines.node.replace(/[^\d.]/g, "");

function versionAtLeast(current, required) {
  const cur = current.split(".").map(Number);
  const req = required.split(".").map(Number);
  for (let i = 0; i < req.length; i++) {
    if ((cur[i] || 0) > (req[i] || 0)) return true;
    if ((cur[i] || 0) < (req[i] || 0)) return false;
  }
  return true;
}

if (!versionAtLeast(process.versions.node, requiredVersion)) {
  process.stderr.write(
    `base44 requires Node.js >= ${requiredVersion}, but you are running Node.js ${process.versions.node}.\n` +
      "Upgrade Node.js to use the Base44 CLI: https://nodejs.org/\n",
  );
  process.exit(1);
}

// Disable Clack spinners and animations in non-interactive environments.
// Clack only checks the CI env var, so we set it when stdin/stdout aren't TTYs.
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  process.env.CI = "true";
}

import("../dist/cli/index.js")
  .then(({ runCLI }) => runCLI())
  .catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
    process.exitCode = 1;
  });
