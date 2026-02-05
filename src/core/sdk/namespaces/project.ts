/**
 * Project namespace for the SDK.
 * Provides project configuration and management operations.
 */

import { dirname, join } from "node:path";
import { SchemaValidationError } from "@/core/internal/errors.js";
import { writeAppConfig as _writeAppConfig } from "@/core/internal/project/app-config.js";
import { findProjectRoot as _findProjectRoot } from "@/core/internal/project/config.js";
import type {
  CreateProjectOptions,
  CreateProjectResult,
} from "@/core/internal/project/create.js";
import { createProjectFiles } from "@/core/internal/project/create.js";
import { ProjectConfigSchema } from "@/core/internal/project/schema.js";
import type {
  ProjectData,
  ProjectRoot,
} from "@/core/internal/project/types.js";
import { readAllAgents } from "@/core/internal/resources/agent/config.js";
import { readAllEntities } from "@/core/internal/resources/entity/config.js";
import { readAllFunctions } from "@/core/internal/resources/function/config.js";
import { readJsonFile } from "@/core/internal/utils/fs.js";
import type { SDKConfig } from "../types.js";

export class ProjectNamespace {
  constructor(private config: SDKConfig) {}

  /**
   * Read the full project configuration including all resources.
   */
  async readConfig(): Promise<ProjectData> {
    const found = await _findProjectRoot(this.config.projectRoot);
    if (!found) {
      // This shouldn't happen since SDK was initialized with a valid project
      throw new Error(`Project not found at ${this.config.projectRoot}`);
    }

    const { configPath } = found;
    const parsed = await readJsonFile(configPath);
    const result = ProjectConfigSchema.safeParse(parsed);

    if (!result.success) {
      throw new SchemaValidationError(
        "Invalid project configuration",
        result.error
      );
    }

    const project = result.data;
    const configDir = dirname(configPath);

    const [entities, functions, agents] = await Promise.all([
      readAllEntities(join(configDir, project.entitiesDir)),
      readAllFunctions(join(configDir, project.functionsDir)),
      readAllAgents(join(configDir, project.agentsDir)),
    ]);

    return {
      project: { ...project, root: this.config.projectRoot, configPath },
      entities,
      functions,
      agents,
    };
  }

  // Static methods - don't require an existing project

  /**
   * Find a project root by walking up the directory tree.
   */
  static async findRoot(startPath?: string): Promise<ProjectRoot | null> {
    return _findProjectRoot(startPath);
  }

  /**
   * Create a new project from a template.
   */
  static async create(
    options: CreateProjectOptions
  ): Promise<CreateProjectResult> {
    return createProjectFiles(options);
  }

  /**
   * Link a local project to a Base44 app by writing .app.jsonc.
   */
  static async link(projectRoot: string, appId: string): Promise<string> {
    return _writeAppConfig(projectRoot, appId);
  }
}

// Re-export types
export type { CreateProjectOptions, CreateProjectResult };
