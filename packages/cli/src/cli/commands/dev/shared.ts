import { createDevServer } from "@/cli/dev/dev-server/main.js";
import type { CLIContext } from "@/cli/types.js";
import { getDenoWrapperPath } from "@/core/assets.js";
import { getSiteUrl } from "@/core/project/api.js";
import { readProjectConfig } from "@/core/project/config.js";

export function localServerUrl(port: number): string {
  return `http://localhost:${port}`;
}

/**
 * Start the local dev server for the current project (cwd). Shared by the
 * foreground `dev`/`dev run` path and the detached daemon so they behave
 * identically apart from process lifecycle.
 */
export async function startDevServerForProject(args: {
  log: CLIContext["log"];
  port?: number;
  appId: string;
}) {
  const siteUrlPromise = getSiteUrl().catch(() => undefined);
  return createDevServer({
    log: args.log,
    port: args.port,
    appId: args.appId,
    denoWrapperPath: getDenoWrapperPath(),
    loadResources: async () => {
      const { functions, entities, project } = await readProjectConfig();
      const siteUrl = await siteUrlPromise;
      return { functions, entities, project, siteUrl };
    },
  });
}

/** Poll the dev server's health route until it answers or we time out. */
export async function waitForHealth(
  url: string,
  timeoutMs = 20000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/__base44/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        return true;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
