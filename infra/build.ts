import { watch } from "node:fs";
import chalk from "chalk";

const runBuild = async () => {
  const result = await Bun.build({
    entrypoints: ["./src/cli/index.ts"],
    outdir: "./dist/cli",
    target: "node",
    format: "esm",
    sourcemap: "inline",
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

const formatOutput = (outputs: { path: string }[]) => {
  return outputs.map((o) => chalk.cyan(o.path)).join("\n  ");
};

if (process.argv.includes("--watch")) {
  console.log(chalk.yellow("Watching for changes..."));

  const changeHandler = async (event: "rename" | "change", filename: string | null) => {
    const time = new Date().toLocaleTimeString();
    console.log(chalk.dim(`[${time}]`), chalk.gray(`${filename} ${event}d`));

    const result = await runBuild();
    console.log(
      chalk.green(`  ✓ Rebuilt`),
      chalk.dim(`→`),
      formatOutput(result.outputs)
    );
  };

  await runBuild();

  for (const dir of ["./src"]) {
    watch(dir, { recursive: true }, changeHandler);
  }

  // Keep process alive
  await new Promise(() => {});
} else {
  const result = await runBuild();
  console.log(chalk.green.bold(`\n✓ Build complete\n`));
  console.log(chalk.dim("  Output:"));
  console.log(`  ${formatOutput(result.outputs)}\n`);
}
