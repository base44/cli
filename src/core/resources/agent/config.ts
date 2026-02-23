import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { globby } from "globby";
import { InvalidInputError, SchemaValidationError } from "@/core/errors.js";
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

async function readAgentFile(
  agentPath: string,
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

async function readAgentFiles(agentsDir: string): Promise<AgentFileEntry[]> {
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
    }),
  );
}

function buildNameToEntryMap(
  entries: AgentFileEntry[],
): Map<string, AgentFileEntry> {
  const nameToEntry = new Map<string, AgentFileEntry>();
  for (const entry of entries) {
    if (nameToEntry.has(entry.data.name)) {
      throw new InvalidInputError(`Duplicate agent name "${entry.data.name}"`, {
        hints: [
          {
            message: `Remove duplicate agents with name "${entry.data.name}" - only one agent per name is allowed`,
          },
        ],
      });
    }
    nameToEntry.set(entry.data.name, entry);
  }
  return nameToEntry;
}

export async function readAllAgents(agentsDir: string): Promise<AgentConfig[]> {
  const entries = await readAgentFiles(agentsDir);
  const nameToEntry = buildNameToEntryMap(entries);
  return [...nameToEntry.values()].map((e) => e.data);
}

function findAvailablePath(
  agentsDir: string,
  name: string,
  claimedPaths: Set<string>,
): string {
  const base = join(agentsDir, `${name}.${CONFIG_FILE_EXTENSION}`);
  if (!claimedPaths.has(base)) {
    return base;
  }
  for (let i = 1; ; i++) {
    const candidate = join(agentsDir, `${name}_${i}.${CONFIG_FILE_EXTENSION}`);
    if (!claimedPaths.has(candidate)) {
      return candidate;
    }
  }
}

export async function writeAgents(
  agentsDir: string,
  remoteAgents: AgentConfigApiResponse[],
): Promise<{ written: string[]; deleted: string[] }> {
  const entries = await readAgentFiles(agentsDir);
  const nameToEntry = buildNameToEntryMap(entries);

  const newNames = new Set(remoteAgents.map((a) => a.name));

  const deleted: string[] = [];
  for (const [name, entry] of nameToEntry) {
    if (!newNames.has(name)) {
      await deleteFile(entry.filePath);
      deleted.push(name);
    }
  }

  // Track all paths that are in use (existing files that weren't deleted)
  const claimedPaths = new Set<string>();
  for (const [name, entry] of nameToEntry) {
    if (newNames.has(name)) {
      claimedPaths.add(entry.filePath);
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
      findAvailablePath(agentsDir, agent.name, claimedPaths);
    claimedPaths.add(filePath);
    await writeJsonFile(filePath, agent);
    written.push(agent.name);
  }

  return { written, deleted };
}
