import { join } from "node:path";
import { PROJECT_SUBDIR, TYPES_OUTPUT_SUBDIR } from "@/core/consts.js";
import { pathExists, readJsonFile, writeJsonFile } from "@/core/utils/fs.js";

const TYPES_INCLUDE_PATH = `${PROJECT_SUBDIR}/${TYPES_OUTPUT_SUBDIR}/*.d.ts`;

/**
 * Update project configuration files after generating types.
 * Currently handles:
 * - tsconfig.json: adds base44/.types to the include array
 *
 * @returns true if tsconfig.json was updated, false otherwise
 */
export async function updateProjectConfig(
  projectRoot: string
): Promise<boolean> {
  const tsconfigPath = join(projectRoot, "tsconfig.json");

  if (!(await pathExists(tsconfigPath))) {
    return false;
  }

  try {
    const tsconfig = (await readJsonFile(tsconfigPath)) as {
      include?: string[];
    };

    // Ensure include array exists
    if (!tsconfig.include) {
      tsconfig.include = [];
    }

    // Check if already included
    if (tsconfig.include.includes(TYPES_INCLUDE_PATH)) {
      return false;
    }

    // Add to include array
    tsconfig.include.push(TYPES_INCLUDE_PATH);
    await writeJsonFile(tsconfigPath, tsconfig);
    return true;
  } catch {
    // If we can't parse or update, silently fail and let user configure manually
    return false;
  }
}
