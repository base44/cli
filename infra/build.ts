import { watch } from "node:fs";
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

const runAllBuilds = async () => {
  const cli = await runBuild({
    entrypoints: ["./src/cli/index.ts"],
    outdir: "./dist/cli",
  });
  const denoRuntime = await runBuild({
    entrypoints: ["./deno-runtime/main.ts"],
    outdir: "./dist/deno-runtime",
  });
  return {
    cli,
    denoRuntime,
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

    const { cli, denoRuntime } = await runAllBuilds();
    for (const result of [cli, denoRuntime]) {
      if (result.success && result.outputs.length > 0) {
        console.log(
          chalk.green(`  ✓ Rebuilt`),
          chalk.dim(`→`),
          formatOutput(result.outputs),
        );
      }
    }
  };

  await runAllBuilds();

  for (const dir of ["./src", "./deno-runtime"]) {
    watch(dir, { recursive: true }, changeHandler);
  }

  // Keep process alive
  await new Promise(() => {});
} else {
  const { cli, denoRuntime } = await runAllBuilds();
  console.log(chalk.green.bold(`\n✓ Build complete\n`));
  console.log(chalk.dim("  Output:"));
  console.log(`  ${formatOutput(cli.outputs)}`);
  console.log(`  ${formatOutput(denoRuntime.outputs)}`);
}
