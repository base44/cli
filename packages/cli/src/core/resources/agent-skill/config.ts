import { join } from "node:path";
import frontmatter from "front-matter";
import { globby } from "globby";
import { stringify as stringifyYaml } from "yaml";
import { SchemaValidationError } from "@/core/errors.js";
import {
  deleteFile,
  pathExists,
  readTextFile,
  writeFile,
} from "../../utils/fs.js";
import type { AgentSkill } from "./schema.js";
import { AgentSkillSchema } from "./schema.js";

function parseSkillFile(raw: string): { description: string; body: string } {
  const { attributes, body } = frontmatter<{ description?: unknown }>(raw);
  const description =
    typeof attributes.description === "string"
      ? attributes.description.trim()
      : "";
  return { description, body: body.trim() };
}

function serializeSkillFile(skill: AgentSkill): string {
  const frontmatterBlock = stringifyYaml({
    description: skill.description,
  }).trimEnd();
  return `---\n${frontmatterBlock}\n---\n\n${skill.body}\n`;
}

export async function readAllAgentSkills(dir: string): Promise<AgentSkill[]> {
  if (!(await pathExists(dir))) {
    return [];
  }
  const files = await globby("*.md", { cwd: dir, absolute: true });
  return await Promise.all(
    files.map(async (filePath) => {
      const name = filePath.split(/[/\\]/).pop()?.replace(/\.md$/, "") ?? "";
      const { description, body } = parseSkillFile(
        await readTextFile(filePath),
      );
      const result = AgentSkillSchema.safeParse({ name, description, body });
      if (!result.success) {
        throw new SchemaValidationError(
          "Invalid skill file",
          result.error,
          filePath,
        );
      }
      return result.data;
    }),
  );
}

export async function writeAgentSkills(
  dir: string,
  remote: AgentSkill[],
): Promise<{ written: string[]; deleted: string[] }> {
  const existing = await readAllAgentSkills(dir);
  const remoteNames = new Set(remote.map((s) => s.name));

  const deleted: string[] = [];
  for (const skill of existing) {
    if (!remoteNames.has(skill.name)) {
      await deleteFile(join(dir, `${skill.name}.md`));
      deleted.push(skill.name);
    }
  }

  const existingByName = new Map(existing.map((s) => [s.name, s]));
  const written: string[] = [];
  for (const skill of remote) {
    const prev = existingByName.get(skill.name);
    if (
      prev &&
      prev.description === skill.description &&
      prev.body === skill.body
    ) {
      continue;
    }
    await writeFile(join(dir, `${skill.name}.md`), serializeSkillFile(skill));
    written.push(skill.name);
  }

  return { written, deleted };
}
