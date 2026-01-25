import { join, dirname } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { readProjectConfig, findProjectRoot } from "../project/config.js";
import { EntityDefinitionSchema, type EntityDefinition } from "./schema.js";
import { generateNodeTypes, generateDenoTypes } from "./generator.js";

export interface GenerateOptions {
  /** Output directory relative to project root (default: "base44") */
  output?: string;
  /** Skip generating Deno types */
  nodeOnly?: boolean;
}

export interface GenerateResult {
  /** Number of entities processed */
  entityCount: number;
  /** Files that were generated */
  files: string[];
  /** Output directory path */
  outputDir: string;
}

/**
 * Parse entities into EntityDefinition format for type generation
 */
function parseEntities(entities: Record<string, unknown>[]): EntityDefinition[] {
  return entities
    .map((entity) => {
      const result = EntityDefinitionSchema.safeParse(entity);
      if (result.success) {
        return result.data;
      }
      // Skip invalid entities but log warning with error details
      const entityName = (entity as { name?: string }).name ?? "unknown";
      console.warn(
        `Skipping invalid entity "${entityName}": ${result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", ")}`
      );
      return null;
    })
    .filter((e): e is EntityDefinition => e !== null);
}

/**
 * Generate TypeScript declaration files from local entity schemas.
 *
 * Generates:
 * - types.d.ts - For Node.js (declare module '@base44/sdk')
 * - types.deno.d.ts - For Deno (declare module 'npm:@base44/sdk')
 */
export async function generateTypes(
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const { output = "base44", nodeOnly = false } = options;

  // Find project root
  const projectRoot = await findProjectRoot();
  if (!projectRoot) {
    throw new Error(
      "Project root not found. Please run this command from within a Base44 project."
    );
  }

  // Read project config and entities
  const { entities } = await readProjectConfig(projectRoot.root);

  // Parse entities into our schema format
  const parsedEntities = parseEntities(entities);

  // Determine output directory (base44/ by default)
  const outputDir = join(projectRoot.root, output);

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  const files: string[] = [];

  // Generate Node.js types.d.ts
  const nodeTypesContent = await generateNodeTypes(parsedEntities);
  const nodeTypesPath = join(outputDir, "types.d.ts");
  await writeFile(nodeTypesPath, nodeTypesContent, "utf-8");
  files.push(nodeTypesPath);

  // Generate Deno types.deno.d.ts (unless node-only)
  if (!nodeOnly) {
    const denoTypesContent = await generateDenoTypes(parsedEntities);
    const denoTypesPath = join(outputDir, "types.deno.d.ts");
    await writeFile(denoTypesPath, denoTypesContent, "utf-8");
    files.push(denoTypesPath);
  }

  return {
    entityCount: parsedEntities.length,
    files,
    outputDir,
  };
}
