import { join } from "node:path";
import { PROJECT_SUBDIR, TYPES_OUTPUT_SUBDIR } from "@/core/consts.js";
import { pathExists, readJsonFile, writeJsonFile } from "@/core/utils/fs.js";

const TYPES_INCLUDE_PATH = `${PROJECT_SUBDIR}/${TYPES_OUTPUT_SUBDIR}/*.d.ts`;
// Actor sources must be in the TS program so the ambient base44:runtime/actors
// declaration (in base44/.types) applies to them; otherwise entry.ts still
// reports "Cannot find module 'base44:runtime/actors'".
const ACTORS_INCLUDE_PATH = `${PROJECT_SUBDIR}/actors/**/*.ts`;

/**
 * Update project configuration files after generating types.
 * Currently handles:
 * - tsconfig.json: adds base44/.types and base44/actors to the include array
 *
 * @returns true if tsconfig.json was updated, false otherwise
 */
export async function updateProjectConfig(
  projectRoot: string,
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

    let changed = false;
    for (const path of [TYPES_INCLUDE_PATH, ACTORS_INCLUDE_PATH]) {
      if (!tsconfig.include.includes(path)) {
        tsconfig.include.push(path);
        changed = true;
      }
    }

    if (changed) {
      await writeJsonFile(tsconfigPath, tsconfig);
    }
    return changed;
  } catch {
    // If we can't parse or update, silently fail and let user configure manually
    return false;
  }
}
