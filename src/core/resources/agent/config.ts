import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { globby } from "globby";
import { SchemaValidationError } from "@/core/errors.js";
import {
  CONFIG_FILE_EXTENSION,
  CONFIG_FILE_EXTENSION_GLOB,
} from "../../consts.js";
import {
  deleteFile,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../../utils/fs.js";
import type { AgentConfig, AgentConfigApiResponse } from "./schema.js";
import { AgentConfigSchema } from "./schema.js";

/**
 * Convert an agent name to a filesystem-safe filename slug.
 * Lowercases, replaces non-alphanumeric characters with underscores,
 * and collapses consecutive underscores.
 */
function toFileSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

async function readAgentFile(
  agentPath: string
): Promise<{ data: AgentConfig; raw: unknown }> {
  const raw = await readJsonFile(agentPath);
  const result = AgentConfigSchema.safeParse(raw);

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid agent file",
      result.error,
      agentPath,
    );
  }

  return { data: result.data, raw };
}

interface AgentFileEntry {
  data: AgentConfig;
  raw: unknown;
  filePath: string;
}

async function readAgentFiles(
  agentsDir: string
): Promise<AgentFileEntry[]> {
  if (!(await pathExists(agentsDir))) {
    return [];
  }

  const files = await globby(`*.${CONFIG_FILE_EXTENSION_GLOB}`, {
    cwd: agentsDir,
    absolute: true,
  });

  return await Promise.all(
    files.map(async (filePath) => {
      const { data, raw } = await readAgentFile(filePath);
      return { data, raw, filePath };
    })
  );
}

export async function readAllAgents(agentsDir: string): Promise<AgentConfig[]> {
  const entries = await readAgentFiles(agentsDir);

  const names = new Set<string>();
  for (const { data } of entries) {
    if (names.has(data.name)) {
      throw new Error(`Duplicate agent name "${data.name}"`);
    }
    names.add(data.name);
  }

  return entries.map((e) => e.data);
}

export async function writeAgents(
  agentsDir: string,
  remoteAgents: AgentConfigApiResponse[],
): Promise<{ written: string[]; deleted: string[] }> {
  const entries = await readAgentFiles(agentsDir);

  const nameToEntry = new Map<string, AgentFileEntry>();
  for (const entry of entries) {
    if (nameToEntry.has(entry.data.name)) {
      throw new Error(`Duplicate agent name "${entry.data.name}"`);
    }
    nameToEntry.set(entry.data.name, entry);
  }

  const newNames = new Set(remoteAgents.map((a) => a.name));

  const deleted: string[] = [];
  for (const [name, entry] of nameToEntry) {
    if (!newNames.has(name)) {
      await deleteFile(entry.filePath);
      deleted.push(name);
    }
  }

  const written: string[] = [];
  for (const agent of remoteAgents) {
    const existing = nameToEntry.get(agent.name);

    if (existing && isDeepStrictEqual(existing.raw, agent)) {
      continue;
    }

    const filePath =
      existing?.filePath ??
      join(agentsDir, `${agent.name}.${CONFIG_FILE_EXTENSION}`);
    await writeJsonFile(filePath, agent);
    written.push(agent.name);
  }

  return { written, deleted };
}
