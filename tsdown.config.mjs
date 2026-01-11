import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  platform: "node",
  outDir: "dist/cli",
  clean: true,
  tsconfig: "tsconfig.json",
  copy: ["src/core/project/templates"],
});
