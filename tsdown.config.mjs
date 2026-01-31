import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli/index.ts"],  // Bundle the barrel export, bin files are source
  format: ["esm"],
  platform: "node",
  outDir: "dist",
  clean: true,
  tsconfig: "tsconfig.json",
  copy: ["templates"],
  sourcemap: "inline",  // Include inline sourcemaps for readable stack traces
});
