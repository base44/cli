import { join } from "node:path";
import { globby } from "globby";
import { SchemaValidationError } from "@/core/errors.js";
import {
  deleteFile,
  pathExists,
  readTextFile,
  writeFile,
} from "../../utils/fs.js";
import type { AgentSkill } from "./schema.js";
import { AgentSkillSchema } from "./schema.js";

// ponytail: descriptions are single-line (backend max 1024, no newlines), so a
// minimal `key: value` frontmatter reader is enough — no YAML dependency.
function parseSkillFile(raw: string): { description: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { description: "", body: raw.trim() };
  }
  const [, frontmatter, body] = match;
  let description = "";
  for (const line of frontmatter.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv && kv[1] === "description") {
      description = kv[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return { description, body: body.trim() };
}

function serializeSkillFile(skill: AgentSkill): string {
  return `---\ndescription: ${skill.description}\n---\n\n${skill.body}\n`;
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
