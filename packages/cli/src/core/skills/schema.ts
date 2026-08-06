import { isAbsolute, relative } from "node:path";
import { InvalidInputError } from "@/core/errors.js";

/** Filename that marks a directory as a skill. */
export const SKILL_FILE = "SKILL.md";

/**
 * Where skills land inside the app repo. Deliberately not configurable — the
 * in-sandbox agent looks here, so a per-invocation override would only ever
 * produce skills it cannot find.
 */
export const SKILLS_DEST_DIR = ".agents/skills";

/** Glob patterns never copied, regardless of where they appear in a skill. */
export const IGNORED_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.DS_Store",
];

export interface SkillFile {
  /** Path relative to the skill directory. Always POSIX-separated. */
  relativePath: string;
  absolutePath: string;
}

export interface LocalSkill {
  /**
   * Directory basename. This is the destination folder name — a skill's
   * directory name is what identifies it on disk.
   */
  dirName: string;
  /** `name` from SKILL.md frontmatter. Empty when absent; display only. */
  name: string;
  /** `description` from SKILL.md frontmatter. Empty when absent; display only. */
  description: string;
  absolutePath: string;
  files: SkillFile[];
}

/**
 * Guard a skill directory name before it becomes a remote path segment.
 * A name carrying a separator or a `..` would let a skill write outside
 * SKILLS_DEST_DIR.
 */
export function assertSafeDirName(dirName: string): void {
  if (
    dirName === "" ||
    dirName === "." ||
    dirName === ".." ||
    dirName.includes("/") ||
    dirName.includes("\\")
  ) {
    throw new InvalidInputError(
      `Invalid skill directory name: "${dirName}". Skill directory names cannot be empty, "." or "..", or contain path separators.`,
    );
  }
}

/**
 * Guard a collected file path before it becomes a remote path segment. globby
 * yields paths relative to the skill root, but a symlink or an unusual entry
 * could still produce something that escapes it.
 */
export function assertSafeRelativePath(
  relativePath: string,
  dirName: string,
): void {
  if (
    relativePath === "" ||
    isAbsolute(relativePath) ||
    relativePath.split("/").includes("..")
  ) {
    throw new InvalidInputError(
      `Skill "${dirName}" contains a file path that escapes its directory: "${relativePath}".`,
    );
  }
}

/**
 * Guard against a symlink that points outside the skill. The apparent path
 * stays inside the skill directory, so assertSafeRelativePath cannot catch
 * this — only the resolved real path can. Both arguments must already be
 * realpath-resolved.
 */
export function assertWithinSkillRoot(
  realRoot: string,
  realPath: string,
  dirName: string,
): void {
  const rel = relative(realRoot, realPath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new InvalidInputError(
      `Skill "${dirName}" contains a link that resolves outside its directory: "${realPath}". Remove it and try again.`,
    );
  }
}

/**
 * The sandbox bridge's write_file takes `content` as a plain string with no
 * encoding field, so a binary payload cannot survive the round trip. Detect it
 * up front with a NUL-byte scan and skip rather than write corrupted bytes.
 */
export function isBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}
