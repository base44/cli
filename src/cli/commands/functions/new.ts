import { dirname, join } from "node:path";
import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/index.js";
import { pathExists, writeFile, writeJsonFile } from "@/core/utils/fs.js";

const FUNCTION_TEMPLATE = `Deno.serve(async (req: Request) => {
  return new Response(JSON.stringify({ message: "Hello from {{name}}!" }), {
    headers: { "Content-Type": "application/json" },
  });
});
`;

async function newFunctionAction(name: string): Promise<RunCommandResult> {
  // Validate name format
  if (name.includes(".")) {
    throw new InvalidInputError("Function name cannot contain dots");
  }

  const { project, functions } = await readProjectConfig();

  // Check for name collision with existing local functions
  if (functions.some((f) => f.name === name)) {
    throw new InvalidInputError(
      `Function "${name}" already exists in this project`,
    );
  }

  const configDir = dirname(project.configPath);
  const functionsDir = join(configDir, project.functionsDir);
  const functionDir = join(functionsDir, name);

  if (await pathExists(functionDir)) {
    throw new InvalidInputError(
      `Directory "${functionDir}" already exists`,
    );
  }

  const configPath = join(functionDir, "function.jsonc");
  const entryPath = join(functionDir, "index.ts");

  await writeJsonFile(configPath, { name, entry: "index.ts" });
  await writeFile(entryPath, FUNCTION_TEMPLATE.replace("{{name}}", name));

  log.success(`Created ${configPath}`);
  log.success(`Created ${entryPath}`);

  return {
    outroMessage: `Function "${name}" created. Deploy with: base44 functions deploy ${name}`,
  };
}

export function getNewCommand(context: CLIContext): Command {
  return new Command("new")
    .description("Create a new backend function from template")
    .argument("<name>", "Name for the new function")
    .action(async (name: string) => {
      await runCommand(
        () => newFunctionAction(name),
        { requireAuth: false },
        context,
      );
    });
}
