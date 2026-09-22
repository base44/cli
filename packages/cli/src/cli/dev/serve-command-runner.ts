import { createDevLogger } from "@/cli/dev/createDevLogger.js";
import { ServeRunner } from "@/cli/dev/dev-server/serve-runner.js";
import { theme } from "@/cli/utils/index.js";

export interface ServeCommandRunnerOptions {
  serveCommand: string;
  projectRoot: string;
  appId: string;
  appBaseUrl: string;
  onOrigin?: (origin: string) => void;
  ignorePort?: number;
}

export function createServeCommandRunner({
  serveCommand,
  projectRoot,
  appId,
  appBaseUrl,
  onOrigin,
  ignorePort,
}: ServeCommandRunnerOptions): ServeRunner {
  return new ServeRunner({
    command: serveCommand,
    cwd: projectRoot,
    env: {
      VITE_BASE44_APP_ID: appId,
      VITE_BASE44_APP_BASE_URL: appBaseUrl,
    },
    logger: createDevLogger("frontend", theme.colors.base44Orange),
    onOrigin,
    ignorePort,
  });
}
