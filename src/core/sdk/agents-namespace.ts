/**
 * Agents namespace for the SDK.
 * Provides agent read, push, and pull operations.
 */

import { join, dirname } from "node:path";
import type { SDKConfig, AppClient } from "@/core/sdk/types.js";
import { readAllAgents, writeAgents } from "@/core/resources/agent/config.js";
import { pushAgents as apiPushAgents, fetchAgents } from "@/core/resources/agent/api.js";
import type { AgentConfig, SyncAgentsResponse } from "@/core/resources/agent/schema.js";
import { findProjectRoot } from "@/core/project/config.js";
import { readJsonFile } from "@/core/utils/fs.js";
import { ProjectConfigSchema } from "@/core/project/schema.js";
import { SchemaValidationError } from "@/core/errors.js";

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
      throw new SchemaValidationError("Invalid project configuration", result.error);
    }

    return join(dirname(found.configPath), result.data.agentsDir);
  }
}
