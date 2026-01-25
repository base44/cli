import { join } from "node:path";
import { globby } from "globby";
import { readJsonFile, pathExists, writeJsonFile, deleteFile } from "../../utils/fs.js";
import { AgentConfigSchema } from "./schema.js";
import type { AgentConfig, AgentConfigApiResponse } from "./schema.js";
import { CONFIG_FILE_EXTENSION_GLOB, CONFIG_FILE_EXTENSION } from "../../consts.js";

async function readAgentFile(agentPath: string): Promise<AgentConfig> {
  const parsed = await readJsonFile(agentPath);
  const result = AgentConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Invalid agent configuration in ${agentPath}: ${result.error.issues
        .map((e) => e.message)
        .join(", ")}`
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
    files.map((filePath) => readAgentFile(filePath))
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
  agents: AgentConfigApiResponse[]
): Promise<{ written: string[]; deleted: string[] }> {
  // Read existing agents to determine which files to delete
  const existingAgents = await readAllAgents(agentsDir);
  const newNames = new Set(agents.map((a) => a.name));

  // Delete agents that no longer exist on remote
  const toDelete = existingAgents.filter((a) => !newNames.has(a.name));
  for (const agent of toDelete) {
    const filePath = join(agentsDir, `${agent.name}.${CONFIG_FILE_EXTENSION}`);
    await deleteFile(filePath);
  }

  // Write all agents from remote
  for (const agent of agents) {
    const filePath = join(agentsDir, `${agent.name}.${CONFIG_FILE_EXTENSION}`);
    await writeJsonFile(filePath, {
      name: agent.name,
      description: agent.description,
      instructions: agent.instructions,
      tool_configs: agent.tool_configs,
      whatsapp_greeting: agent.whatsapp_greeting ?? null,
    });
  }

  const written = agents.map((a) => a.name);
  const deleted = toDelete.map((a) => a.name);

  return { written, deleted };
}
