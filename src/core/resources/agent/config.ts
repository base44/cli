import { join } from "node:path";
import { globby } from "globby";
import { readJsonFile, pathExists, writeJsonFile, deleteFile } from "../../utils/fs.js";
import { AgentConfigSchema } from "./schema.js";
import type { AgentConfig, AgentConfigApiResponse } from "./schema.js";
import { CONFIG_FILE_EXTENSION_GLOB, CONFIG_FILE_EXTENSION } from "../../consts.js";

export function generateAgentConfigContent(name: string): string {
  return `// Base44 Agent Configuration
// Agent name must be lowercase alphanumeric with underscores only
{
  "name": "${name}",
  // Brief description of what this agent does
  "description": "",
  // Detailed instructions for the agent's behavior
  "instructions": "",
  // Tool configurations - entity tools and backend function tools
  // Entity tool example: { "entity_name": "tasks", "allowed_operations": ["read", "create"] }
  // Function tool example: { "function_name": "send_email", "description": "Send an email" }
  "tool_configs": [],
  // Optional WhatsApp greeting message
  "whatsapp_greeting": null
}
`;
}

async function readAgentFile(agentPath: string): Promise<AgentConfig> {
  const parsed = await readJsonFile(agentPath);
  const result = AgentConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Invalid agent config in ${agentPath}: ${result.error.message}`
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
  remoteAgents: AgentConfigApiResponse[]
): Promise<{ written: string[]; deleted: string[] }> {
  const existingAgents = await readAllAgents(agentsDir);
  const newNames = new Set(remoteAgents.map((a) => a.name));

  const toDelete = existingAgents.filter((a) => !newNames.has(a.name));
  for (const agent of toDelete) {
    const files = await globby(`${agent.name}.${CONFIG_FILE_EXTENSION_GLOB}`, {
      cwd: agentsDir,
      absolute: true,
    });
    for (const filePath of files) {
      await deleteFile(filePath);
    }
  }

  for (const agent of remoteAgents) {
    const filePath = join(agentsDir, `${agent.name}.${CONFIG_FILE_EXTENSION}`);
    await writeJsonFile(filePath, agent);
  }

  const written = remoteAgents.map((a) => a.name);
  const deleted = toDelete.map((a) => a.name);

  return { written, deleted };
}
