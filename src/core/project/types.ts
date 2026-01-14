import type { Entity } from "../resources/entity/index.js";
import type { FunctionConfig } from "../resources/function/index.js";
import type { ProjectConfig } from "./schema.js";

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
  functions: FunctionConfig[];
}
