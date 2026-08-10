import type { ProjectConfig } from "@/core/project/schema.js";
import type { AgentConfig } from "@/core/resources/agent/index.js";
import type { AgentSkill } from "@/core/resources/agent-skill/index.js";
import type { AuthConfig } from "@/core/resources/auth-config/index.js";
import type { ConnectorResource } from "@/core/resources/connector/index.js";
import type { Entity } from "@/core/resources/entity/index.js";
import type { BackendFunction } from "@/core/resources/function/index.js";

export interface ProjectWithPaths extends ProjectConfig {
  root: string;
  configPath: string;
}

export interface ProjectRoot {
  root: string;
  configPath: string;
}

export interface ProjectData {
  project: ProjectWithPaths;
  entities: Entity[];
  functions: BackendFunction[];
  agents: AgentConfig[];
  agentSkills: AgentSkill[];
  connectors: ConnectorResource[];
  authConfig: AuthConfig[];
}
