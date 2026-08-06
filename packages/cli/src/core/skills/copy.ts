import { writeFile as writeSandboxFile } from "@/core/resources/sandbox/api.js";
import { readFile } from "@/core/utils/fs.js";
import type { LocalSkill } from "./schema.js";
import { isBinary, SKILLS_DEST_DIR } from "./schema.js";

export interface CopySkillResult {
  /** The skill's directory name, which is also its destination folder. */
  skill: string;
  /** Remote paths written, relative to the app root. */
  written: string[];
  /** Paths (relative to the skill directory) skipped because they are binary. */
  skippedBinary: string[];
}

/**
 * Destination path for a file inside a skill. Remote paths are always POSIX,
 * so this joins with "/" rather than path.join.
 */
function remoteSkillPath(dirName: string, relativePath: string): string {
  return `${SKILLS_DEST_DIR}/${dirName}/${relativePath}`;
}

/**
 * Copy one skill's directory into SKILLS_DEST_DIR in the app's sandbox.
 * Binary files are reported back rather than written — see isBinary().
 */
export async function copySkill(
  appId: string,
  skill: LocalSkill,
  options: { overwrite?: boolean } = {},
): Promise<CopySkillResult> {
  const written: string[] = [];
  const skippedBinary: string[] = [];

  // Sequential on purpose: the bridge takes one file per request, and a skill
  // with a large references/ directory would otherwise fire dozens of
  // concurrent writes at it.
  for (const file of skill.files) {
    const buffer = await readFile(file.absolutePath);
    if (isBinary(buffer)) {
      skippedBinary.push(file.relativePath);
      continue;
    }

    const path = remoteSkillPath(skill.dirName, file.relativePath);
    await writeSandboxFile(appId, {
      path,
      content: buffer.toString("utf-8"),
      overwrite: options.overwrite,
    });
    written.push(path);
  }

  return { skill: skill.dirName, written, skippedBinary };
}
