/**
 * Agents namespace for the SDK.
 * Provides agent read, push, and pull operations.
 */

import { dirname, join } from "node:path";
import { SchemaValidationError } from "@/core/internal/errors.js";
import { findProjectRoot } from "@/core/internal/project/config.js";
import { ProjectConfigSchema } from "@/core/internal/project/schema.js";
import {
  pushAgents as apiPushAgents,
  fetchAgents,
} from "@/core/internal/resources/agent/api.js";
import {
  readAllAgents,
  writeAgents,
} from "@/core/internal/resources/agent/config.js";
import type {
  AgentConfig,
  SyncAgentsResponse,
} from "@/core/internal/resources/agent/schema.js";
import { readJsonFile } from "@/core/internal/utils/fs.js";
import type { AppClient, SDKConfig } from "../types.js";

export class AgentsNamespace {
  constructor(
    private config: SDKConfig,
    private client: AppClient
  ) {}

  /**
   * Read all agents from the project's agents directory.
   */
  async readAll(): Promise<AgentConfig[]> {
    const agentsDir = await this.getAgentsDir();
    return readAllAgents(agentsDir);
  }

  /**
   * Push agents to Base44.
   * Syncs local agents with remote, creating/updating/deleting as needed.
   */
  async push(agents: AgentConfig[]): Promise<SyncAgentsResponse> {
    if (agents.length === 0) {
      return { created: [], updated: [], deleted: [] };
    }
    return apiPushAgents(agents, this.client);
  }

  /**
   * Pull agents from Base44 and write to local files.
   * Returns the written and deleted agent names.
   */
  async pull(): Promise<{ written: string[]; deleted: string[] }> {
    const agentsDir = await this.getAgentsDir();
    const remoteAgents = await fetchAgents(this.client);
    return writeAgents(agentsDir, remoteAgents.items);
  }

  private async getAgentsDir(): Promise<string> {
    const found = await findProjectRoot(this.config.projectRoot);
    if (!found) {
      throw new Error(`Project not found at ${this.config.projectRoot}`);
    }

    const parsed = await readJsonFile(found.configPath);
    const result = ProjectConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new SchemaValidationError(
        "Invalid project configuration",
        result.error
      );
    }

    return join(dirname(found.configPath), result.data.agentsDir);
  }
}
