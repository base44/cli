import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import frontmatter from "front-matter";
import { globby } from "globby";
import { InvalidInputError } from "@/core/errors.js";
import { pathExists, readTextFile } from "@/core/utils/fs.js";
import type { LocalSkill, SkillFile } from "./schema.js";
import {
  assertSafeDirName,
  assertSafeRelativePath,
  assertWithinSkillRoot,
  IGNORED_PATTERNS,
  SKILL_FILE,
} from "./schema.js";

interface SkillFrontmatter {
  name?: unknown;
  description?: unknown;
}

/**
 * Pull `name` and `description` out of a SKILL.md. Both are display-only —
 * neither is required, and neither affects where the skill is copied.
 */
async function readSkillMetadata(
  skillDir: string,
): Promise<{ name: string; description: string }> {
  const raw = await readTextFile(join(skillDir, SKILL_FILE));
  const { attributes } = frontmatter<SkillFrontmatter>(raw);
  return {
    name: typeof attributes.name === "string" ? attributes.name.trim() : "",
    description:
      typeof attributes.description === "string"
        ? attributes.description.trim()
        : "",
  };
}

async function readSkill(skillDir: string): Promise<LocalSkill> {
  const dirName = basename(skillDir);
  assertSafeDirName(dirName);

  const { name, description } = await readSkillMetadata(skillDir);

  // globby yields forward slashes on every platform, which is what the remote
  // paths need — do not normalize these to the OS separator.
  //
  // followSymbolicLinks is off so a link pointing at a parent directory cannot
  // pull unrelated local files into the upload. The relative path alone cannot
  // catch that: it still looks like it sits inside the skill.
  const relativePaths = await globby("**/*", {
    cwd: skillDir,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: IGNORED_PATTERNS,
  });

  // Resolve the root once so links are compared against the real directory,
  // not the path we were handed (which may itself be a link).
  const realRoot = await realpath(skillDir);

  const files: SkillFile[] = await Promise.all(
    relativePaths.sort().map(async (relativePath) => {
      assertSafeRelativePath(relativePath, dirName);
      const absolutePath = join(skillDir, relativePath);
      assertWithinSkillRoot(realRoot, await realpath(absolutePath), dirName);
      return { relativePath, absolutePath };
    }),
  );

  return { dirName, name, description, absolutePath: skillDir, files };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Does this directory carry a usable skill marker?
 *
 * lstat, not stat: a symlinked SKILL.md reads fine but is excluded from the
 * copy by followSymbolicLinks, which would ship a skill with no SKILL.md and
 * report success. Refuse it outright rather than let that through.
 */
async function hasRegularSkillFile(dir: string): Promise<boolean> {
  const markerPath = join(dir, SKILL_FILE);
  try {
    const stats = await lstat(markerPath);
    if (stats.isFile()) {
      return true;
    }
    throw new InvalidInputError(
      `${markerPath} must be a regular file (found a ${stats.isSymbolicLink() ? "symlink" : "directory"}). A ${SKILL_FILE} that is not a regular file is never copied, which would leave the skill unusable.`,
    );
  } catch (error) {
    if (error instanceof InvalidInputError) {
      throw error;
    }
    return false;
  }
}

async function findSkillSubdirectories(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name))
    .sort();

  const skillDirs: string[] = [];
  for (const candidate of candidates) {
    if (await hasRegularSkillFile(candidate)) {
      skillDirs.push(candidate);
    }
  }
  return skillDirs;
}

/**
 * Resolve a local directory into the skills it contains.
 *
 * - `<dir>/SKILL.md` exists -> the directory is itself one skill.
 * - otherwise -> every immediate subdirectory holding a SKILL.md is a skill.
 *
 * Only one level of nesting is scanned; that matches how skills are laid out
 * on disk and keeps the picker free of unrelated directories.
 *
 * @throws InvalidInputError when the path is missing, is not a directory,
 * holds no SKILL.md at either level, or holds a SKILL.md that is not a
 * regular file.
 */
export async function discoverLocalSkills(dir: string): Promise<LocalSkill[]> {
  const skillsDir = resolve(dir);

  if (!(await pathExists(skillsDir))) {
    throw new InvalidInputError(`Directory not found: ${skillsDir}`);
  }
  if (!(await isDirectory(skillsDir))) {
    throw new InvalidInputError(
      `Not a directory: ${skillsDir}. Point this command at a skill directory, or at a directory containing skill directories.`,
    );
  }

  if (await hasRegularSkillFile(skillsDir)) {
    return [await readSkill(skillsDir)];
  }

  const skillDirs = await findSkillSubdirectories(skillsDir);
  if (skillDirs.length === 0) {
    throw new InvalidInputError(
      `No skills found in ${skillsDir}. Expected a ${SKILL_FILE} in that directory, or in one of its immediate subdirectories.`,
    );
  }

  return await Promise.all(skillDirs.map(readSkill));
}
