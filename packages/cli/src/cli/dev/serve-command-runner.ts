import { createDevLogger } from "@/cli/dev/createDevLogger.js";
import { ServeRunner } from "@/cli/dev/dev-server/serve-runner.js";
import { theme } from "@/cli/utils/index.js";

interface ServeCommandRunnerOptions {
  serveCommand: string;
  projectRoot: string;
  appId: string;
  appBaseUrl: string;
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
      VITE_BASE44_APP_BASE_URL: appBaseUrl,
    },
    logger: createDevLogger("frontend", theme.colors.base44Orange),
  });
}
