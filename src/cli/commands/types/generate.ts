import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import type { ProjectSDK } from "@/core/sdk.js";

const TYPES_FILE_PATH = "base44/.types/types.d.ts";

async function generateTypesAction(sdk: ProjectSDK): Promise<RunCommandResult> {
  const { entities, functions, agents, project } =
    await sdk.project.readConfig();

  await runTask("Generating types", async () => {
    await sdk.types.generate({ entities, functions, agents });
  });

  const tsconfigUpdated = await sdk.types.updateProjectConfig(project.root);

  return {
    outroMessage: tsconfigUpdated
      ? `Generated ${TYPES_FILE_PATH} and updated tsconfig.json`
      : `Generated ${TYPES_FILE_PATH}`,
  };
}

export function getTypesGenerateCommand(context: CLIContext): Command {
  return new Command("generate")
    .description(
      "Generate TypeScript declaration file (types.d.ts) from project resources"
    )
    .action(async () => {
      await runCommand(generateTypesAction, { requireAuth: false }, context);
    });
}
