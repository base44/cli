import type { Command } from "commander";
import type { RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask } from "@/cli/utils/index.js";
import { readProjectConfig } from "@/core/index.js";
import { generateTypesFile, updateProjectConfig } from "@/core/types/index.js";

const TYPES_FILE_PATH = "base44/.types/types.d.ts";

async function generateTypesAction(): Promise<RunCommandResult> {
  const { entities, functions, agents, connectors, project } =
    await readProjectConfig();

  await runTask("Generating types", async () => {
    await generateTypesFile({ entities, functions, agents, connectors });
  });

  const tsconfigUpdated = await updateProjectConfig(project.root);

  return {
    outroMessage: tsconfigUpdated
      ? `Generated ${TYPES_FILE_PATH} and updated tsconfig.json`
      : `Generated ${TYPES_FILE_PATH}`,
  };
}

export function getTypesGenerateCommand(): Command {
  return new Base44Command("generate", { requireAuth: false })
    .description(
      "Generate TypeScript declaration file (types.d.ts) from project resources",
    )
    .action(generateTypesAction);
}
