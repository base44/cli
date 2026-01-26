import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  platform: "node",
  outDir: "dist",
  clean: true,
  tsconfig: "tsconfig.json",
  copy: ["templates"],
});
