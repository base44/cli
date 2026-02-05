import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { readProjectConfig } from "@/core/index.js";
import {
  generateBase44TypesFile,
  updateProjectConfig,
} from "@/core/types/index.js";

const TYPES_FILE_PATH = "base44/.types/types.d.ts";

async function generateTypesAction(): Promise<RunCommandResult> {
  const { entities, functions, agents, project } = await readProjectConfig();

  await runTask("Generating types", async () => {
    await generateBase44TypesFile({ entities, functions, agents });
  });

  // Try to update project configuration
  const tsconfigUpdated = await updateProjectConfig(project.root);

  if (tsconfigUpdated) {
    return {
      outroMessage: `Generated ${TYPES_FILE_PATH} and updated tsconfig.json`,
    };
  }

  return {
    outroMessage: `Generated ${TYPES_FILE_PATH}`,
  };
}

export function getTypesGenerateCommand(context: CLIContext): Command {
  return new Command("generate")
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
