import { pathExists } from "@/core/utils/fs.js";
import { collectModules } from "./modules.js";
import type { WorkerModule } from "./schema.js";
import type { ResolvedWranglerConfig } from "./wrangler-config.js";
import {
  detectFullStackArtifact,
  resolveWranglerConfig,
} from "./wrangler-config.js";

interface FullStackBuild {
  config: ResolvedWranglerConfig;
  modules: WorkerModule[];
  /**
   * Where the Worker serves assets from, confirmed to exist. `null` is a Worker
   * that answers every path itself — a complete app, not a broken build.
   */
  assetsDir: string | null;
}

/**
 * The full-stack artifact this build left behind, or `null` for a plain static
 * site. ONE reader for both lanes — two would eventually disagree about the
 * same directory.
 */
export async function resolveFullStackBuild(
  projectRoot: string,
): Promise<FullStackBuild | null> {
  const redirectPath = await detectFullStackArtifact(projectRoot);
  if (!redirectPath) {
    return null;
  }

  const config = await resolveWranglerConfig(redirectPath);
  return {
    config,
    modules: await collectModules(config),
    assetsDir:
      config.assetsDirectory && (await pathExists(config.assetsDirectory))
        ? config.assetsDirectory
        : null,
  };
}
