import { join, dirname } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { readProjectConfig, findProjectRoot } from "../project/config.js";
import { EntityDefinitionSchema, type EntityDefinition } from "./schema.js";
import {
  generateEntitiesFile,
  generateClientFile,
  generateIndexFile,
} from "./generator.js";

export interface GenerateOptions {
  /** Output directory relative to project root (default: "src/base44") */
  output?: string;
  /** Only generate entity types, skip client types */
  entitiesOnly?: boolean;
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
      console.warn(`Skipping invalid entity "${entityName}": ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
      return null;
    })
    .filter((e): e is EntityDefinition => e !== null);
}

/**
 * Generate TypeScript types from local entity schemas
 */
export async function generateTypes(
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const { output = "src/base44", entitiesOnly = false } = options;

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

  // Determine output directory
  const outputDir = join(projectRoot.root, output);

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  const files: string[] = [];

  // Generate entities file
  const entitiesContent = generateEntitiesFile(parsedEntities);
  const entitiesPath = join(outputDir, "entities.ts");
  await writeFile(entitiesPath, entitiesContent, "utf-8");
  files.push(entitiesPath);

  // Generate client file (unless entities-only)
  if (!entitiesOnly) {
    const clientContent = generateClientFile(parsedEntities);
    const clientPath = join(outputDir, "client.ts");
    await writeFile(clientPath, clientContent, "utf-8");
    files.push(clientPath);

    // Generate index file
    const indexContent = generateIndexFile();
    const indexPath = join(outputDir, "index.ts");
    await writeFile(indexPath, indexContent, "utf-8");
    files.push(indexPath);
  }

  return {
    entityCount: parsedEntities.length,
    files,
    outputDir,
  };
}
