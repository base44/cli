/**
 * Functions namespace for the SDK.
 * Provides function read and deploy operations.
 */

import { join, dirname, basename } from "node:path";
import type { SDKConfig, AppClient } from "@/core/sdk/types.js";
import { readAllFunctions } from "@/core/resources/function/config.js";
import { deployFunctions } from "@/core/resources/function/api.js";
import { readTextFile, readJsonFile } from "@/core/utils/fs.js";
import type {
  BackendFunction,
  FunctionDeploy,
  DeployFunctionsResponse,
  FunctionFile,
} from "@/core/resources/function/schema.js";
import { findProjectRoot } from "@/core/project/config.js";
import { ProjectConfigSchema } from "@/core/project/schema.js";
import { SchemaValidationError } from "@/core/errors.js";

export class FunctionsNamespace {
  constructor(
    private config: SDKConfig,
    private client: AppClient
  ) {}

  /**
   * Read all functions from the project's functions directory.
   */
  async readAll(): Promise<BackendFunction[]> {
    const functionsDir = await this.getFunctionsDir();
    return readAllFunctions(functionsDir);
  }

  /**
   * Deploy functions to Base44.
   * Reads file contents and uploads to the API.
   */
  async deploy(functions: BackendFunction[]): Promise<DeployFunctionsResponse> {
    if (functions.length === 0) {
      return { deployed: [], deleted: [], errors: null };
    }

    const functionsWithCode = await Promise.all(
      functions.map((fn) => this.loadFunctionCode(fn))
    );
    // Cast to FunctionWithCode[] as the API function expects that type
    // but only uses the fields we provide (name, entry, files)
    return deployFunctions(functionsWithCode as any, this.client);
  }

  private async loadFunctionCode(fn: BackendFunction): Promise<FunctionDeploy> {
    const loadedFiles: FunctionFile[] = await Promise.all(
      fn.filePaths.map(async (filePath: string) => {
        const content = await readTextFile(filePath);
        return { path: basename(filePath), content };
      })
    );
    return { name: fn.name, entry: fn.entry, files: loadedFiles };
  }

  private async getFunctionsDir(): Promise<string> {
    const found = await findProjectRoot(this.config.projectRoot);
    if (!found) {
      throw new Error(`Project not found at ${this.config.projectRoot}`);
    }

    const parsed = await readJsonFile(found.configPath);
    const result = ProjectConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new SchemaValidationError("Invalid project configuration", result.error);
    }

    return join(dirname(found.configPath), result.data.functionsDir);
  }
}
