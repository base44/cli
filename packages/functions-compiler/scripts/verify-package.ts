// Packaging proof: pack the package, install the tarball into a throwaway
// directory that can see neither this repo nor apper, and run a real compile
// there on the host `node`. Catches the failure a source-tree test cannot —
// a runtime asset (a shim, or a .ts module the plugins read as text) that the
// build never copied into lib/, or a native/WASM dependency that does not load.
//
//   bun run scripts/verify-package.ts        # uses `node` from PATH
//   NODE_BIN=/path/to/node20 bun run ...     # pin the toolchain under test

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const nodeBin = process.env.NODE_BIN ?? "node";

if (!existsSync(path.join(packageRoot, "lib", "src", "index.js"))) {
  throw new Error("lib/ is missing — run `bun run build` first.");
}

const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

// A function that exercises every asset family at once: the injected Deno shim
// and worker entry, the base44:runtime virtual module, and npm resolution.
const PROBE_FUNCTION = `
import { createHash } from "node:crypto";
import slugify from "npm:slugify@1.6.6";

Deno.serve(() => {
  const tag = slugify("Packaging Proof");
  const digest = createHash("sha256").update(tag).digest("hex").slice(0, 8);
  return new Response(JSON.stringify({ tag, digest }));
});
`;

const PROBE = `
import assert from "node:assert/strict";
import { bundle } from "@base44/functions-compiler";

const result = await bundle({
  entry: "main.ts",
  files: { "main.ts": ${JSON.stringify(PROBE_FUNCTION)} },
});
assert.equal(result.ok, true, "compile failed: " + JSON.stringify(result.errors ?? []));
assert.equal(result.main_module, "_bundled.mjs");
// The Deno shim and the resolved npm dependency both have to be inlined; a
// missing asset would otherwise surface only at runtime in workerd.
assert.match(result.module, /globalThis\\.Deno/, "deno shim missing from output");
assert.match(result.module, /slugify/i, "npm dependency missing from output");
console.log("compiled " + result.module.length + " bytes on node " + process.version);
`;

const work = await mkdtemp(path.join(tmpdir(), "b44-compiler-pack-"));
try {
  const packed = run("npm", ["pack", "--silent", "--pack-destination", work], packageRoot).trim();
  const tarball = path.join(work, packed.split("\n").at(-1)!);

  const consumer = path.join(work, "consumer");
  await writeFile(
    path.join(work, ".npmrc"),
    "registry=https://registry.npmjs.org/\n@jsr:registry=https://npm.jsr.io\n",
  );
  run("mkdir", ["-p", consumer], work);
  await writeFile(
    path.join(consumer, "package.json"),
    JSON.stringify({ name: "compiler-package-probe", private: true, type: "module" }),
  );
  await writeFile(path.join(consumer, ".npmrc"), "registry=https://registry.npmjs.org/\n@jsr:registry=https://npm.jsr.io\n");
  run("npm", ["install", "--silent", "--no-audit", "--no-fund", tarball], consumer);

  await writeFile(path.join(consumer, "probe.mjs"), PROBE);
  process.stdout.write(run(nodeBin, ["probe.mjs"], consumer));
  console.log(`packaged compiler works from ${tarball}`);
} finally {
  await rm(work, { recursive: true, force: true });
}
