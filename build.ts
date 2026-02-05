import { watch } from "node:fs";
import { cp } from "node:fs/promises";
import path from "node:path";

const distDir = "./dist";

const runBuild = async () => {
  return await Bun.build({
    entrypoints: ["./src/cli/index.ts"],
    outdir: distDir,
    target: "node",
    format: "esm",
    sourcemap: "inline",
  });
}

await cp("./templates", path.join(distDir, "templates"), { recursive: true });

if (process.argv.includes("--watch")) {
  console.log("\nWatching for changes...");
  
  for (const dir of ["./src"]) {
    watch(dir, { recursive: true }, async (event, filename) => {
      const cliBuild = await runBuild();
			console.log(cliBuild.outputs.map((o) => o.path).join(", "));
    });
  }
  
  // Keep process alive
  await new Promise(() => {});
} else {
  const cliBuild = await runBuild();
	console.log("✓ Build complete");
	console.log(cliBuild.outputs.map((o) => o.path).join(", "));
}
