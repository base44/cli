import { Command } from "commander";
import { log } from "@clack/prompts";
import { generateTypes } from "@core/types/index.js";
import { runCommand, runTask } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";
import { relative } from "node:path";

interface GenerateTypesOptions {
  output?: string;
  nodeOnly?: boolean;
}

async function generateTypesAction(
  options: GenerateTypesOptions
): Promise<RunCommandResult> {
  const result = await runTask(
    "Generating TypeScript types",
    async () => {
      return await generateTypes({
        output: options.output,
        nodeOnly: options.nodeOnly,
      });
    },
    {
      successMessage: "Types generated successfully",
      errorMessage: "Failed to generate types",
    }
  );

  if (result.entityCount === 0) {
    log.warn("No entities found in project");
    return { outroMessage: "No types generated" };
  }

  log.info(`Generated types for ${result.entityCount} entities`);
  log.info(`Output directory: ${result.outputDir}`);

  const fileList = result.files
    .map((f) => `  - ${relative(process.cwd(), f)}`)
    .join("\n");
  log.info(`Files:\n${fileList}`);

  return { outroMessage: "Types generated successfully!" };
}

export const typesGenerateCommand = new Command("types")
  .description("Generate TypeScript declaration files from entity schemas")
  .option("-o, --output <dir>", "Output directory (default: base44)")
  .option("--node-only", "Only generate Node.js types, skip Deno types")
  .action(async (options: GenerateTypesOptions) => {
    await runCommand(() => generateTypesAction(options), {
      requireAuth: false,
      requireAppConfig: false,
    });
  });
