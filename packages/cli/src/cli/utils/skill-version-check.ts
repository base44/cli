import { join } from "node:path";
import { note } from "@clack/prompts";
import { execa } from "execa";
import frontmatter from "front-matter";
import { z } from "zod";
import { theme } from "@/cli/utils/theme.js";
import { readTextFile } from "@/core/utils/fs.js";
import packageJson from "../../../package.json";

export interface StaleSkillInfo {
  skillName: string;
  installedVersion: string;
  currentVersion: string;
}

const SourcePackageSchema = z.object({
  name: z.string(),
  version: z.string(),
});

const SkillFrontmatterSchema = z.object({
  metadata: z.object({
    sourcePackage: SourcePackageSchema,
  }),
});

const InstalledSkillSchema = z.object({
  name: z.string(),
  path: z.string(),
});

const InstalledSkillsSchema = z.array(InstalledSkillSchema);

async function listInstalledSkills(
  cwd: string,
): Promise<z.infer<typeof InstalledSkillsSchema>> {
  const { stdout } = await execa("npx", ["-y", "skills", "list", "--json"], {
    cwd,
    timeout: 3000,
    env: { ...process.env, CI: "1" },
  });

  // npx may emit non-JSON preamble (download progress, warnings) before the array
  const jsonStart = stdout.indexOf("[");
  if (jsonStart === -1) return [];
  const parsed = JSON.parse(stdout.slice(jsonStart));
  return InstalledSkillsSchema.parse(parsed);
}

export async function readSkillFrontmatter(
  skillPath: string,
): Promise<z.infer<typeof SkillFrontmatterSchema> | null> {
  try {
    const content = await readTextFile(join(skillPath, "SKILL.md"));
    const { attributes } = frontmatter<Record<string, unknown>>(content);
    const result = SkillFrontmatterSchema.safeParse(attributes);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

async function checkSkillVersions(
  projectRoot: string,
): Promise<StaleSkillInfo[]> {
  const skills = await listInstalledSkills(projectRoot);

  const results = await Promise.all(
    skills.map(async (skill) => {
      const fm = await readSkillFrontmatter(skill.path);
      if (!fm) return null;
      if (fm.metadata.sourcePackage.name !== packageJson.name) return null;
      if (fm.metadata.sourcePackage.version === packageJson.version)
        return null;
      return {
        skillName: skill.name,
        installedVersion: fm.metadata.sourcePackage.version,
        currentVersion: packageJson.version,
      };
    }),
  );

  return results.filter((r): r is StaleSkillInfo => r !== null);
}

export function startSkillVersionCheck(
  projectRoot: string,
): Promise<StaleSkillInfo[] | null> {
  return checkSkillVersions(projectRoot).catch(() => null);
}

function formatSkillWarning(staleSkills: StaleSkillInfo[]): string {
  const { shinyOrange } = theme.colors;
  const { bold } = theme.styles;

  const lines = staleSkills.map((s) =>
    shinyOrange(
      `Skill "${s.skillName}" was built for v${s.installedVersion}, current CLI is v${bold(s.currentVersion)}`,
    ),
  );
  lines.push(shinyOrange("Run: base44 agent-skills update"));

  return lines.join("\n");
}

export function formatPlainSkillWarning(staleSkills: StaleSkillInfo[]): string {
  const lines = staleSkills.map(
    (s) =>
      `Skill "${s.skillName}" was built for v${s.installedVersion}, current CLI is v${s.currentVersion}.`,
  );
  lines.push("Run: base44 agent-skills update");
  return lines.join(" ");
}

export async function printSkillVersionWarning(
  promise: Promise<StaleSkillInfo[] | null>,
): Promise<void> {
  try {
    const staleSkills = await promise;
    if (staleSkills && staleSkills.length > 0) {
      note(formatSkillWarning(staleSkills));
    }
  } catch {}
}
