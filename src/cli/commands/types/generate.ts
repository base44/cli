import { join, dirname } from "node:path";
import { Command } from "commander";
import { log } from "@clack/prompts";
import type { CLIContext } from "@/cli/types.js";
import { readProjectConfig } from "@/core/index.js";
import { writeAllTypesFiles } from "@/core/types/index.js";
import { runCommand, runTask, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

interface TypesCommandOptions {
  output?: string;
}

async function generateTypesAction(options: TypesCommandOptions): Promise<RunCommandResult> {
  const { entities, functions, agents, project } = await readProjectConfig();

  // Determine output directory
  // Default: base44/ directory next to config.jsonc
  const configDir = dirname(project.configPath);
  const outputDir = options.output ?? join(configDir, "");

  // Log what we found
  const resourceCounts: string[] = [];
  if (entities.length > 0) {
    resourceCounts.push(`${entities.length} ${entities.length === 1 ? "entity" : "entities"}`);
  }
  if (functions.length > 0) {
    resourceCounts.push(`${functions.length} ${functions.length === 1 ? "function" : "functions"}`);
  }
  if (agents.length > 0) {
    resourceCounts.push(`${agents.length} ${agents.length === 1 ? "agent" : "agents"}`);
  }

  if (resourceCounts.length === 0) {
    log.warn("No entities, functions, or agents found in project");
    log.info("Add resources and run 'base44 types' again");
    return { outroMessage: "No types generated" };
  }

  log.info(`Found ${resourceCounts.join(", ")}`);

  const result = await runTask(
    "Generating types",
    async () => {
      return await writeAllTypesFiles(
        { entities, functions, agents },
        { outputDir }
      );
    },
    {
      successMessage: theme.colors.base44Orange("Types generated successfully"),
      errorMessage: "Failed to generate types",
    }
  );

  // Log generated files
  log.success(`Generated ${result.files.length} files:`);
  for (const file of result.files) {
    log.message(`  ${theme.styles.dim("•")} ${file}`);
  }

  // Provide setup hints
  log.info("");
  log.info(theme.styles.header("Setup instructions:"));
  log.message(`  Add to ${theme.styles.bold("tsconfig.json")}:`);
  log.message(`    { "include": ["src", "base44/types.d.ts"] }`);
  log.message("");
  log.message(`  Add $schema to config files for IDE autocomplete:`);
  log.message(`    { "$schema": "./schemas/agent.schema.json", ... }`);

  return {
    outroMessage: `Generated types for ${result.entityCount} entities, ${result.functionCount} functions, ${result.agentCount} agents`,
  };
}

export function getTypesCommand(context: CLIContext): Command {
  return new Command("types")
    .description("Generate TypeScript declaration files from project schemas")
    .option("-o, --output <dir>", "Output directory (default: base44/)")
    .action(async (options: TypesCommandOptions) => {
      await runCommand(
        () => generateTypesAction(options),
        { requireAuth: false, requireAppConfig: false },
        context
      );
    });
}
