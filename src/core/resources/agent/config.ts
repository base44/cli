import { join } from "node:path";
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

async function readAgentFile(agentPath: string): Promise<AgentConfig> {
  const parsed = await readJsonFile(agentPath);
  const result = AgentConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid agent file",
      result.error,
      agentPath,
    );
  }

  return result.data;
}

export async function readAllAgents(agentsDir: string): Promise<AgentConfig[]> {
  if (!(await pathExists(agentsDir))) {
    return [];
  }

  const files = await globby(`*.${CONFIG_FILE_EXTENSION_GLOB}`, {
    cwd: agentsDir,
    absolute: true,
  });

  const agents = await Promise.all(
    files.map((filePath) => readAgentFile(filePath)),
  );

  const names = new Set<string>();
  for (const agent of agents) {
    if (names.has(agent.name)) {
      throw new Error(`Duplicate agent name "${agent.name}"`);
    }
    names.add(agent.name);
  }

  return agents;
}

export async function writeAgents(
  agentsDir: string,
  remoteAgents: AgentConfigApiResponse[],
): Promise<{ written: string[]; deleted: string[] }> {
  const existingAgents = await readAllAgents(agentsDir);
  const newNames = new Set(remoteAgents.map((a) => a.name));

  const toDelete = existingAgents.filter((a) => !newNames.has(a.name));
  for (const agent of toDelete) {
    const slug = toFileSlug(agent.name);
    const files = await globby(`${slug}.${CONFIG_FILE_EXTENSION_GLOB}`, {
      cwd: agentsDir,
      absolute: true,
    });
    for (const filePath of files) {
      await deleteFile(filePath);
    }
  }

  for (const agent of remoteAgents) {
    const slug = toFileSlug(agent.name);
    const filePath = join(agentsDir, `${slug}.${CONFIG_FILE_EXTENSION}`);
    await writeJsonFile(filePath, agent);
  }

  const written = remoteAgents.map((a) => a.name);
  const deleted = toDelete.map((a) => a.name);

  return { written, deleted };
}
