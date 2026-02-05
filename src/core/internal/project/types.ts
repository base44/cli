import type { ProjectConfig } from "@/core/internal/project/schema.js";
import type { AgentConfig } from "@/core/internal/resources/agent/index.js";
import type { Entity } from "@/core/internal/resources/entity/index.js";
import type { BackendFunction } from "@/core/internal/resources/function/index.js";

interface ProjectWithPaths extends ProjectConfig {
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
}
