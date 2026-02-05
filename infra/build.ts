import { watch } from "node:fs";

const runBuild = async () => {
  const result = await Bun.build({
    entrypoints: ["./src/cli/index.ts"],
    outdir: "./dist/cli",
    target: "node",
    format: "esm",
    sourcemap: "inline",
  });
  if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }
  return result;
}

if (process.argv.includes("--watch")) {
  console.log("\nWatching for changes...");
  const changeHandler = async (event: "rename" | "change", filename: string | null) => {
    const cliBuild = await runBuild();
    console.log(cliBuild.outputs.map((o) => o.path).join(", "));
  }
  
  for (const dir of ["./src"]) {
    watch(dir, { recursive: true }, changeHandler);
  }
  
  // Keep process alive
  await new Promise(() => {});
} else {
  const cliBuild = await runBuild();
	console.log("✓ Build complete");
  console.log(cliBuild.outputs.map((o) => o.path).join(", "));
}
