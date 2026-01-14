import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  platform: "node",
  outDir: "dist/cli",
  clean: true,
  tsconfig: "tsconfig.json",
  copy: ["templates"],
  // Bundle all dependencies into a single file for zero-dependency distribution
  noExternal: [/.*/],
});
