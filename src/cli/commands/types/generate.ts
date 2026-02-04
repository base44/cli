import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { readProjectConfig } from "@/core/index.js";
import { generateBase44TypesFile } from "@/core/types/index.js";

async function generateTypesAction(): Promise<RunCommandResult> {
  const { entities, functions, agents } = await readProjectConfig();

  await runTask(
    "Generating types",
    async () => {
      await generateBase44TypesFile({ entities, functions, agents });
    },
    {
      successMessage: theme.colors.base44Orange("Types generated successfully"),
      errorMessage: "Failed to generate types",
    }
  );

  log.success("Generated base44/.types/types.d.ts");

  log.info("");
  log.info(theme.styles.header("Setup:"));
  log.message(`  Add to ${theme.styles.bold("tsconfig.json")}:`);
  log.message(`    { "include": ["src", "base44/.types"] }`);

  return {
    outroMessage: "Types written to base44/.types/types.d.ts",
  };
}

export function getTypesCommand(context: CLIContext): Command {
  return new Command("types")
    .description(
      "Generate TypeScript declaration file (types.d.ts) from project resources"
    )
    .action(async () => {
      await runCommand(
        () => generateTypesAction(),
        { requireAuth: false },
        context
      );
    });
}
