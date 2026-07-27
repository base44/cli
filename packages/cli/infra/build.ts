import { watch, copyFileSync, mkdirSync } from "node:fs";
import type { BuildConfig } from "bun";
import chalk from "chalk";

const runBuild = async (config: BuildConfig) => {
  const defaultBuildOptions: Partial<BuildConfig> = {
    target: "node",
    format: "esm",
    sourcemap: "external",
  };

  const result = await Bun.build({
    ...defaultBuildOptions,
    ...config,
  });

  if (!result.success) {
    console.error(chalk.red.bold("\n✗ Build failed\n"));
    for (const log of result.logs) {
      console.error(chalk.red(`  ${log}`));
    }
    process.exit(1);
  }

  return result;
};

const copyBackendRuntime = () => {
  const outDir = "./dist/assets/backend-runtime";
  mkdirSync(outDir, { recursive: true });
  copyFileSync("./backend-runtime/main.ts", `${outDir}/main.ts`);
  copyFileSync("./backend-runtime/exec.ts", `${outDir}/exec.ts`);
  // The import map and the module it points at must land next to main.ts —
  // function-manager.ts resolves the config relative to the wrapper.
  copyFileSync("./backend-runtime/import-map.json", `${outDir}/import-map.json`);
  copyFileSync(
    "./backend-runtime/base44-runtime.ts",
    `${outDir}/base44-runtime.ts`,
  );
  return outDir;
};

// Runtime dependencies of the local workerd function runtime. They cannot be
// bundled (workerd and esbuild ship native binaries; @deno/loader ships WASM),
// so they are real npm `dependencies` resolved from node_modules at runtime —
// the one deliberate exception to the zero-dependency distribution rule. The
// standalone binary excludes them too and `base44 dev` falls back to the Deno
// runtime there.
export const RUNTIME_EXTERNALS = ["miniflare", "esbuild", "@deno/loader"];

const runAllBuilds = async () => {
  const cli = await runBuild({
    entrypoints: ["./src/cli/index.ts"],
    outdir: "./dist/cli",
    external: RUNTIME_EXTERNALS,
  });
  const backendRuntimePath = copyBackendRuntime();
  return {
    cli,
    backendRuntimePath,
  };
};

const formatOutput = (outputs: { path: string }[]) => {
  return outputs.map((o) => chalk.cyan(o.path)).join("\n  ");
};

if (process.argv.includes("--watch")) {
  console.log(chalk.yellow("Watching for changes..."));

  const changeHandler = async (
    event: "rename" | "change",
    filename: string | null,
  ) => {
    const time = new Date().toLocaleTimeString();
    console.log(chalk.dim(`[${time}]`), chalk.gray(`${filename} ${event}d`));

    const { cli, backendRuntimePath } = await runAllBuilds();
    if (cli.success && cli.outputs.length > 0) {
      console.log(
        chalk.green(`  ✓ Rebuilt`),
        chalk.dim(`→`),
        formatOutput(cli.outputs),
      );
    }
    console.log(
      chalk.green(`  ✓ Copied`),
      chalk.dim(`→`),
      chalk.cyan(backendRuntimePath),
    );
  };

  await runAllBuilds();

  for (const dir of ["./src", "./backend-runtime"]) {
    watch(dir, { recursive: true }, changeHandler);
  }

  // Keep process alive
  await new Promise(() => {});
} else {
  const { cli, backendRuntimePath } = await runAllBuilds();
  console.log(chalk.green.bold(`\n✓ Build complete\n`));
  console.log(chalk.dim("  Output:"));
  console.log(`  ${formatOutput(cli.outputs)}`);
  console.log(`  ${chalk.cyan(backendRuntimePath)}`);
}
