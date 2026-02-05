/**
 * Functions namespace for the SDK.
 * Provides function read and deploy operations.
 */

import { basename, dirname, join } from "node:path";
import { SchemaValidationError } from "@/core/internal/errors.js";
import { findProjectRoot } from "@/core/internal/project/config.js";
import { ProjectConfigSchema } from "@/core/internal/project/schema.js";
import { deployFunctions } from "@/core/internal/resources/function/api.js";
import { readAllFunctions } from "@/core/internal/resources/function/config.js";
import type {
  BackendFunction,
  DeployFunctionsResponse,
  FunctionDeploy,
  FunctionFile,
} from "@/core/internal/resources/function/schema.js";
import { readJsonFile, readTextFile } from "@/core/internal/utils/fs.js";
import type { AppClient, SDKConfig } from "../types.js";

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
    return deployFunctions(functionsWithCode, this.client);
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
      throw new SchemaValidationError(
        "Invalid project configuration",
        result.error
      );
    }

    return join(dirname(found.configPath), result.data.functionsDir);
  }
}
