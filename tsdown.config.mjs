import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli/program.ts"],  // Only build the program, bin files are source
  format: ["esm"],
  platform: "node",
  outDir: "dist",
  clean: true,
  tsconfig: "tsconfig.json",
  copy: ["templates"],
});
