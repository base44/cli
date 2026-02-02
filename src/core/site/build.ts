import { execa } from "execa";
import type { SiteConfig } from "@/core/project/schema.js";

export interface BuildSiteOptions {
  site: SiteConfig;
  cwd: string;
}

/**
 * Builds a site using the configured build command.
 * Returns true if build was executed, false if skipped (no build command configured).
 */
export async function buildSite(options: BuildSiteOptions): Promise<boolean> {
  const { site, cwd } = options;

  // Skip build if no buildCommand is configured
  if (!site.buildCommand) {
    return false;
  }

  // Execute the build command
  await execa({ cwd, shell: true })`${site.buildCommand}`;

  return true;
}
