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
   * The directory the Worker serves its assets from, confirmed to exist.
   * `null` when the config declares none, or when this build produced none —
   * a Worker that answers every path itself is a complete app.
   */
  assetsDir: string | null;
}

/**
 * The full-stack artifact this project's build left behind, or `null` when it
 * built a plain static site.
 *
 * ONE reader, for both lanes. "What did the framework build" has a single
 * answer; two readers of the same directory would eventually give two, and the
 * lane that publishes would disagree with the lane that deploys.
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
