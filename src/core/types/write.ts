import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { Entity } from "@/core/resources/entity/index.js";
import type { Function } from "@/core/resources/function/index.js";
import type { AgentConfig } from "@/core/resources/agent/index.js";
import { generateTypesFileContent } from "./template.js";
import { generateAllJsonSchemas } from "./json-schema-generator.js";

/**
 * Input for writing all type files.
 */
export interface WriteTypesInput {
  entities: Entity[];
  functions: Function[];
  agents: AgentConfig[];
}

/**
 * Options for writing type files.
 */
export interface WriteTypesOptions {
  outputDir: string;
}

/**
 * Result of writing type files.
 */
export interface WriteTypesResult {
  files: string[];
  entityCount: number;
  functionCount: number;
  agentCount: number;
}

/**
 * Write the .d.ts types file.
 */
async function writeTypesDeclarationFile(
  input: WriteTypesInput,
  outputDir: string
): Promise<string> {
  const content = await generateTypesFileContent(input);
  const filePath = join(outputDir, "types.d.ts");
  await writeFile(filePath, content, "utf-8");
  return "types.d.ts";
}

/**
 * Write JSON Schema files for config IDE autocomplete.
 */
async function writeJsonSchemaFiles(
  input: WriteTypesInput,
  outputDir: string
): Promise<string[]> {
  const schemasDir = join(outputDir, "schemas");
  await mkdir(schemasDir, { recursive: true });

  const schemaInput = {
    entityNames: input.entities.map((e) => e.name),
    functionNames: input.functions.map((f) => f.name),
  };

  const schemas = generateAllJsonSchemas(schemaInput);
  const files: string[] = [];

  for (const [filename, schema] of Object.entries(schemas)) {
    const filePath = join(schemasDir, filename);
    await writeFile(filePath, JSON.stringify(schema, null, 2), "utf-8");
    files.push(`schemas/${filename}`);
  }

  return files;
}

/**
 * Write all type files (.d.ts and JSON Schemas).
 */
export async function writeAllTypesFiles(
  input: WriteTypesInput,
  options: WriteTypesOptions
): Promise<WriteTypesResult> {
  const { outputDir } = options;

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  // Write .d.ts file
  const dtsFile = await writeTypesDeclarationFile(input, outputDir);

  // Write JSON Schema files
  const schemaFiles = await writeJsonSchemaFiles(input, outputDir);

  return {
    files: [dtsFile, ...schemaFiles],
    entityCount: input.entities.length,
    functionCount: input.functions.length,
    agentCount: input.agents.length,
  };
}
