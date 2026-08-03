import { execa } from "execa";
import type { CLIContext } from "@/cli/types.js";
import { ConfigNotFoundError } from "@/core/errors.js";

interface SiteBuildTarget {
  root: string;
  buildCommand?: string;
  appId: string;
}

export async function runSiteBuild(
  { runTask }: Pick<CLIContext, "runTask">,
  { root, buildCommand, appId }: SiteBuildTarget,
): Promise<void> {
  if (!buildCommand) {
    throw new ConfigNotFoundError("No site build command found.", {
      hints: [
        {
          message:
            'Add \'site.buildCommand\' to your config.jsonc (e.g., "site": { "buildCommand": "npm run build" })',
        },
      ],
    });
  }

  await runTask(
    "Building site...",
    () =>
      execa({
        cwd: root,
        shell: true,
        env: { VITE_BASE44_APP_ID: appId },
      })`${buildCommand}`,
    {
      successMessage: "Site built successfully",
      errorMessage: "Build failed",
    },
  );
}
