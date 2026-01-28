import type { Entity } from "@/core/resources/entity/index.js";
import type { Function } from "@/core/resources/function/index.js";
import type { AgentConfig } from "@/core/resources/agent/index.js";
import type { ProjectConfig } from "@/core/project/schema.js";

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
  functions: Function[];
  agents: AgentConfig[];
}
