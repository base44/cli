import { createDevLogger } from "@/cli/dev/createDevLogger.js";
import { ServeRunner } from "@/cli/dev/dev-server/serve-runner.js";
import { theme } from "@/cli/utils/index.js";

export interface ServeCommandRunnerOptions {
  serveCommand: string;
  projectRoot: string;
  appId: string;
  /** Omitted when the caller has no backend to name — a frontend that reaches its
   * backend same-origin (the Base44 vite plugin proxies `/api`) must not be told
   * one, or the SDK would call across origins instead. */
  appBaseUrl?: string;
}

export function createServeCommandRunner({
  serveCommand,
  projectRoot,
  appId,
  appBaseUrl,
}: ServeCommandRunnerOptions): ServeRunner {
  return new ServeRunner({
    command: serveCommand,
    cwd: projectRoot,
    env: {
      VITE_BASE44_APP_ID: appId,
      ...(appBaseUrl ? { VITE_BASE44_APP_BASE_URL: appBaseUrl } : {}),
    },
    logger: createDevLogger("frontend", theme.colors.base44Orange),
  });
}
