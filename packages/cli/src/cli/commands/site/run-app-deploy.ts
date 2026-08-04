import type { CLIContext } from "@/cli/types.js";
import { theme } from "@/cli/utils/index.js";
import type { AppDeployResult, AppSiteTarget } from "@/core/site/index.js";
import { deployAppSite, detectAppDeployKind } from "@/core/site/index.js";

const TASK_LABELS = {
  "static-deployment": {
    start: "Deploying site...",
    success: "Site deployed",
    error: "Site deploy failed",
  },
  static: {
    start: "Creating archive and deploying site...",
    success: "Site deployed successfully",
    error: "Deployment failed",
  },
} as const;

/**
 * Run the project's site deploy behind a spinner, adapting the labels and the
 * progress stream to whichever transport applies. The kind is detected here
 * only to pick the messages; `deployAppSite` decides for itself what to ship.
 */
export async function runAppSiteDeploy(
  { runTask, log, staticDeployments }: CLIContext,
  target: AppSiteTarget,
  options: { gitHash?: string } = {},
): Promise<AppDeployResult> {
  const kind = detectAppDeployKind(target, { staticDeployments });
  if (kind === "none") return { kind: "none" };

  const labels = TASK_LABELS[kind];
  const progressLines: string[] = [];

  const result = await runTask(
    labels.start,
    async (updateMessage) =>
      await deployAppSite(target, {
        staticDeployments,
        gitHash: options.gitHash,
        progress: {
          onAssets: ({ totalAssets, newAssets }) => {
            const line = `Found ${totalAssets} static assets (${newAssets} new)`;
            progressLines.push(line);
            updateMessage(line);
          },
          onAssetUpload: ({ uploadedFiles, totalFiles }) => {
            updateMessage(`Uploaded ${uploadedFiles} of ${totalFiles} assets`);
          },
        },
      }),
    {
      successMessage: labels.success,
      errorMessage: labels.error,
    },
  );

  for (const line of progressLines) {
    log.message(theme.styles.dim(line));
  }

  return result;
}
