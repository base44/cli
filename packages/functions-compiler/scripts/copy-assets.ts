// The published package mirrors the source layout under lib/, so every
// `new URL("../<asset>", import.meta.url)` in the compiled plugins resolves the
// same way it does from src/. Two families land here:
//   - .ts modules the esbuild plugins read as TEXT and hand to esbuild with a
//     "ts" loader (runtime-context, runtime/index, private-data-sources/*).
//     They must stay TypeScript — tsc must never compile them.
//   - the generated shims from build-shim.ts (dist/*.mjs), injected verbatim.

import { cp, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = (rel: string) => fileURLToPath(new URL(`../${rel}`, import.meta.url));

const TEXT_ASSETS = [
  "src/runtime-context.ts",
  "src/runtime",
  "src/private-data-sources",
];

for (const asset of TEXT_ASSETS) {
  await cp(root(asset), root(`lib/${asset}`), { recursive: true });
}

await mkdir(root("lib/dist"), { recursive: true });
for (const shim of await readdir(root("dist"))) {
  if (shim.endsWith(".mjs")) await cp(root(`dist/${shim}`), root(`lib/dist/${shim}`));
}

console.log(`copied ${TEXT_ASSETS.length} text assets + shims into lib/`);
