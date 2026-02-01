/**
 * Base44 Local Project SDK
 *
 * Facade for working with local Base44 projects.
 * Provides access to all project operations through namespaced APIs.
 */

import ky from "ky";
import type { KyInstance } from "ky";
import { getBase44ApiUrl } from "@/core/config.js";
import { readAuth, refreshAndSaveTokens, isTokenExpired } from "@/core/auth/config.js";
import { findProjectRoot } from "@/core/project/config.js";
import { findAppConfigPath } from "@/core/project/app-config.js";
import { readJsonFile } from "@/core/utils/fs.js";
import { AppConfigSchema } from "@/core/project/schema.js";
import { ConfigNotFoundError, ConfigInvalidError, SchemaValidationError } from "@/core/errors.js";
import type { SDKConfig } from "./types.js";
import { AuthNamespace } from "./auth-namespace.js";
import { ProjectNamespace   } from "./project-namespace.js";
import type {CreateProjectOptions, CreateProjectResult} from "./project-namespace.js";
import { EntitiesNamespace } from "./entities-namespace.js";
import { FunctionsNamespace } from "./functions-namespace.js";
import { AgentsNamespace } from "./agents-namespace.js";
import { SiteNamespace } from "./site-namespace.js";
import type { SyncEntitiesResponse } from "@/core/resources/entity/schema.js";
import type { DeployFunctionsResponse } from "@/core/resources/function/schema.js";
import type { SyncAgentsResponse } from "@/core/resources/agent/schema.js";
import type { DeployResponse } from "@/core/site/schema.js";

/**
 * Options for deployAll method.
 */
export interface DeployAllOptions {
  /** Deploy entities (default: true) */
  entities?: boolean;
  /** Deploy functions (default: true) */
  functions?: boolean;
  /** Deploy agents (default: true) */
  agents?: boolean;
  /** Deploy site (default: true if site config exists) */
  site?: boolean;
}

/**
 * Result from deployAll method.
 */
export interface DeployAllResult {
  entities?: SyncEntitiesResponse;
  functions?: DeployFunctionsResponse;
  agents?: SyncAgentsResponse;
  site?: DeployResponse;
  appUrl?: string;
}

/**
 * Base44 Local Project SDK
 *
 * Main entry point for working with Base44 projects.
 * Use `Base44LocalProjectSDK.fromCurrentDirectory()` to create an instance.
 *
 * @example
 * ```typescript
 * // Create SDK from current directory
 * const sdk = await Base44LocalProjectSDK.fromCurrentDirectory();
 *
 * // Read and push entities
 * const entities = await sdk.entities.readAll();
 * await sdk.entities.push(entities);
 *
 * // Deploy everything
 * const result = await sdk.deployAll();
 * console.log(`Deployed to: ${result.appUrl}`);
 * ```
 */
export class Base44LocalProjectSDK {
  readonly config: SDKConfig;
  private _client: KyInstance | null = null;

  // Lazy-initialized namespaces
  private _project?: ProjectNamespace;
  private _entities?: EntitiesNamespace;
  private _functions?: FunctionsNamespace;
  private _agents?: AgentsNamespace;
  private _site?: SiteNamespace;

  constructor(config: SDKConfig) {
    this.config = config;
  }

  /**
   * Get the app-scoped HTTP client.
   * Creates the client lazily on first access.
   */
  private getClient(): KyInstance {
    if (!this._client) {
      this._client = this.createAppClient();
    }
    return this._client;
  }

  /**
   * Create an app-scoped HTTP client with auth handling.
   */
  private createAppClient(): KyInstance {
    const baseClient = ky.create({
      prefixUrl: new URL(`/api/apps/${this.config.appId}/`, getBase44ApiUrl()).href,
      headers: {
        "User-Agent": "Base44 CLI",
      },
      hooks: {
        beforeRequest: [
          async (request) => {
            try {
              const auth = await readAuth();

              // Proactively refresh if token is expired or about to expire
              if (isTokenExpired(auth)) {
                const newAccessToken = await refreshAndSaveTokens();
                if (newAccessToken) {
                  request.headers.set("Authorization", `Bearer ${newAccessToken}`);
                  return;
                }
              }

              request.headers.set("Authorization", `Bearer ${auth.accessToken}`);
            } catch {
              // No auth available, continue without header
            }
          },
        ],
      },
    });

    return baseClient;
  }

  /**
   * Project operations (read config, etc.)
   */
  get project(): ProjectNamespace {
    if (!this._project) {
      this._project = new ProjectNamespace(this.config);
    }
    return this._project;
  }

  /**
   * Entity operations (read, push)
   */
  get entities(): EntitiesNamespace {
    if (!this._entities) {
      this._entities = new EntitiesNamespace(this.config, this.getClient());
    }
    return this._entities;
  }

  /**
   * Function operations (read, deploy)
   */
  get functions(): FunctionsNamespace {
    if (!this._functions) {
      this._functions = new FunctionsNamespace(this.config, this.getClient());
    }
    return this._functions;
  }

  /**
   * Agent operations (read, push, pull)
   */
  get agents(): AgentsNamespace {
    if (!this._agents) {
      this._agents = new AgentsNamespace(this.config, this.getClient());
    }
    return this._agents;
  }

  /**
   * Site operations (deploy)
   */
  get site(): SiteNamespace {
    if (!this._site) {
      this._site = new SiteNamespace(this.config, this.getClient());
    }
    return this._site;
  }

  /**
   * Deploy all resources (entities, functions, agents, site).
   * Reads from local filesystem and pushes to Base44.
   */
  async deployAll(options?: DeployAllOptions): Promise<DeployAllResult> {
    const projectData = await this.project.readConfig();
    const result: DeployAllResult = {};

    if (options?.entities !== false && projectData.entities.length > 0) {
      result.entities = await this.entities.push(projectData.entities);
    }
    if (options?.functions !== false && projectData.functions.length > 0) {
      result.functions = await this.functions.deploy(projectData.functions);
    }
    if (options?.agents !== false && projectData.agents.length > 0) {
      result.agents = await this.agents.push(projectData.agents);
    }
    if (options?.site !== false && projectData.project.site?.outputDirectory) {
      const siteResult = await this.site.deploy(projectData.project.site.outputDirectory);
      result.site = siteResult;
      result.appUrl = siteResult.appUrl;
    }

    return result;
  }

  /**
   * Check if there are any resources to deploy.
   */
  async hasResourcesToDeploy(): Promise<boolean> {
    const projectData = await this.project.readConfig();
    return (
      projectData.entities.length > 0 ||
      projectData.functions.length > 0 ||
      projectData.agents.length > 0 ||
      !!projectData.project.site?.outputDirectory
    );
  }

  // ==================== Static Methods ====================

  /**
   * Auth operations (global, not project-scoped)
   */
  static auth = AuthNamespace;

  /**
   * Project operations that don't require an existing SDK instance
   */
  static project = {
    /**
     * Find a project root by walking up the directory tree.
     */
    findRoot: ProjectNamespace.findRoot,

    /**
     * Create a new project from a template.
     */
    create: ProjectNamespace.create as (options: CreateProjectOptions) => Promise<CreateProjectResult>,

    /**
     * Link a local project to a Base44 app.
     */
    link: ProjectNamespace.link,
  };

  /**
   * Create an SDK instance from the current directory.
   * Finds the project root and reads the app config.
   *
   * @throws {ConfigNotFoundError} If no project found
   * @throws {ConfigInvalidError} If .app.jsonc is missing or invalid
   */
  static async fromCurrentDirectory(): Promise<Base44LocalProjectSDK> {
    const projectRoot = await findProjectRoot();
    if (!projectRoot) {
      throw new ConfigNotFoundError(
        "No Base44 project found. Run this command from a project directory with a config.jsonc file."
      );
    }

    const appConfigPath = await findAppConfigPath(projectRoot.root);
    if (!appConfigPath) {
      throw new ConfigInvalidError(
        "App not configured. Create a .app.jsonc file or run 'base44 link' to link this project.",
        {
          hints: [
            { message: "Run 'base44 link' to link this project to a Base44 app", command: "base44 link" },
          ],
        }
      );
    }

    const parsed = await readJsonFile(appConfigPath);
    const result = AppConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new SchemaValidationError("Invalid app configuration", result.error);
    }

    if (!result.data.id) {
      throw new ConfigInvalidError(
        "App ID missing in .app.jsonc. Run 'base44 link' to link this project.",
        {
          hints: [
            { message: "Run 'base44 link' to link this project to a Base44 app", command: "base44 link" },
          ],
        }
      );
    }

    return new Base44LocalProjectSDK({
      projectRoot: projectRoot.root,
      appId: result.data.id,
    });
  }

  /**
   * Create an SDK instance from a specific project path.
   *
   * @param projectRoot - Path to the project root
   * @param appId - Base44 app ID
   */
  static fromConfig(projectRoot: string, appId: string): Base44LocalProjectSDK {
    return new Base44LocalProjectSDK({ projectRoot, appId });
  }
}
