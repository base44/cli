import type { Command } from "commander";
import { runSiteBuild } from "@/cli/commands/project/site-build.js";
import {
  concurrencyOption,
  gitHashOption,
  outputDirOption,
  targetOption,
} from "@/cli/commands/versions/options.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, requireApp, theme } from "@/cli/utils/index.js";
import { resolveBuildTarget } from "@/core/project/index.js";
import { resolveProvenanceCommit } from "@/core/site/index.js";
import {
  collectArtifacts,
  publishVersion,
  tagStep,
} from "@/core/version/index.js";

interface PublishOptions {
  build?: boolean;
  outputDir?: string;
  gitHash?: string;
  target?: string;
  concurrency?: number;
}

/**
 * Build, record a version, and serve it. Not `site deploy`, whose `deploymentId`
 * means a Cloudflare script rather than a deployment on this plane — separate
 * envelope names so the two cannot be confused.
 */
async function publishAction(
  ctx: CLIContext,
  options: PublishOptions,
): Promise<RunCommandResult> {
  const { runTask, log, jsonMode } = ctx;
  const app = requireApp(ctx);
  // Tagged: a config this command cannot read is a version it cannot produce,
  // the same reason `collectArtifacts` is tagged below.
  const target = await tagStep("create_version", () =>
    resolveBuildTarget(app.projectRoot, { outputDir: options.outputDir }),
  );

  if (options.build !== false) {
    await tagStep("build", () =>
      runSiteBuild(ctx, {
        root: target.root,
        buildCommand: target.buildCommand,
        appId: app.id,
      }),
    );
  }

  const gitHash = await resolveProvenanceCommit(target.root, options.gitHash);
  const result = await runTask(
    "Publishing...",
    async (updateMessage) => {
      // Inside the tag, so a missing output directory reports as a
      // create_version failure rather than an envelope with no step.
      const artifacts = await tagStep("create_version", () =>
        collectArtifacts(target),
      );
      return await publishVersion(artifacts, {
        sourceCommit: gitHash,
        target: options.target,
        concurrency: options.concurrency,
        progress: {
          onDeclared: ({ fileCount }) =>
            updateMessage(`Uploading ${fileCount} files`),
          onUpload: ({ uploadedFiles, totalFiles }) =>
            updateMessage(`Uploaded ${uploadedFiles} of ${totalFiles} files`),
        },
      });
    },
    { successMessage: "Published", errorMessage: "Publish failed" },
  );

  if (!jsonMode) {
    log.message(theme.styles.dim(`version ${result.versionId}`));
  }
  return {
    outroMessage: `${result.environment} now serves ${result.versionId}`,
    stdout: jsonMode ? `${JSON.stringify(result, null, 2)}\n` : undefined,
  };
}

export function getPublishCommand(): Command {
  return new Base44Command("publish")
    .description(
      "Build the app, record it as a version, and serve that version",
    )
    .option(
      "--no-build",
      "Publish the existing build output without rebuilding",
    )
    .addOption(outputDirOption())
    .addOption(targetOption())
    .addOption(gitHashOption())
    .addOption(concurrencyOption())
    .action(publishAction);
}
