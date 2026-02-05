/**
 * Site namespace for the SDK.
 * Provides site deployment operations.
 */

import { join } from "node:path";
import { deploySite as _deploySite } from "@/core/internal/site/deploy.js";
import type { DeployResponse } from "@/core/internal/site/schema.js";
import type { AppClient, SDKConfig } from "../types.js";

export class SiteNamespace {
  constructor(
    private config: SDKConfig,
    private client: AppClient
  ) {}

  /**
   * Deploy site files to Base44.
   * Creates a tar.gz archive and uploads it.
   *
   * @param outputDirectory - Path to the built site files (relative to project root or absolute)
   */
  async deploy(outputDirectory: string): Promise<DeployResponse> {
    // If relative path, resolve from project root
    const absolutePath = outputDirectory.startsWith("/")
      ? outputDirectory
      : join(this.config.projectRoot, outputDirectory);

    return _deploySite(absolutePath, this.client);
  }
}
