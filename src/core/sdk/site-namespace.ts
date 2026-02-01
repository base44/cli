/**
 * Site namespace for the SDK.
 * Provides site deployment operations.
 */

import { join } from "node:path";
import type { SDKConfig, AppClient } from "@/core/sdk/types.js";
import { deploySite as _deploySite } from "@/core/site/deploy.js";
import type { DeployResponse } from "@/core/site/schema.js";

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
