import type { Command } from "commander";
import { InvalidArgumentError, Option } from "commander";
import { runSiteBuild } from "@/cli/commands/project/site-build.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { resolveProvenanceCommit } from "@/core/site/index.js";
import { isGitCommitHash } from "@/core/utils/git.js";
import {
  collectBuildOutput,
  collectResources,
  DEFAULT_VERSION_UPLOAD_CONCURRENCY,
  MAX_VERSION_UPLOAD_CONCURRENCY,
  publishVersion,
  requireOutputDir,
  resolvePublishTarget,
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
 * Build, record a version, and serve it — the three steps in order.
 *
 * NOT `site deploy`. That command drives the legacy full-stack hosting lane,
 * whose own source says nothing there publishes; its envelope names a
 * `deploymentId` that means a Cloudflare script, not a deployment on this plane.
 * A caller that could not tell the two apart would publish by accident, so this
 * is a separate command with separate envelope field names.
 */
async function publishAction(
  ctx: CLIContext,
  options: PublishOptions,
): Promise<RunCommandResult> {
  const { runTask, log, jsonMode, app } = ctx;
  const target = await resolvePublishTarget(app?.projectRoot, {
    outputDir: options.outputDir,
  });

  if (options.build !== false) {
    await tagStep("build", () =>
      runSiteBuild(ctx, {
        root: target.root,
        buildCommand: target.buildCommand,
        appId: app?.id ?? "",
      }),
    );
  }

  const outputDir = requireOutputDir(target);
  const gitHash = await resolveProvenanceCommit(target.root, options.gitHash);
  const result = await runTask(
    "Publishing...",
    async (updateMessage) => {
      const artifacts = {
        files: await collectBuildOutput(outputDir),
        ...(await collectResources(target.configDir, target)),
      };
      return await publishVersion(artifacts, {
        sourceCommit: gitHash,
        target: options.target,
        concurrency: options.concurrency,
        progress: {
          onDeclared: ({ fileCount, owedFiles }) =>
            updateMessage(`Uploading ${owedFiles} of ${fileCount} files`),
          onUpload: ({ uploadedFiles, totalFiles }) =>
            updateMessage(`Uploaded ${uploadedFiles} of ${totalFiles} files`),
        },
      });
    },
    { successMessage: "Published", errorMessage: "Publish failed" },
  );

  if (!jsonMode) {
    log.message(
      theme.styles.dim(
        `version ${result.versionId}${result.deduplicated ? " (existing content)" : ""}`,
      ),
    );
  }
  return {
    outroMessage: `Deployment ${result.deploymentId} at revision ${result.revision}`,
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
    .option(
      "--output-dir <dir>",
      "Build output directory (defaults to the project's, else dist)",
    )
    .option("--target <name>", "Environment to serve the version at")
    .addOption(
      new Option(
        "--git-hash <hash>",
        "Commit the build came from (defaults to the checkout's HEAD)",
      ).argParser(parseGitHash),
    )
    .addOption(
      new Option("--concurrency <n>", "Parallel file uploads")
        .default(DEFAULT_VERSION_UPLOAD_CONCURRENCY)
        .argParser(parseConcurrency),
    )
    .action(publishAction);
}

function parseGitHash(value: string): string {
  if (!isGitCommitHash(value)) {
    throw new InvalidArgumentError(
      "Expected a git commit hash (7-64 hex chars).",
    );
  }
  return value;
}

function parseConcurrency(value: string): number {
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_VERSION_UPLOAD_CONCURRENCY
  ) {
    throw new InvalidArgumentError(
      `Expected a whole number between 1 and ${MAX_VERSION_UPLOAD_CONCURRENCY}.`,
    );
  }
  return parsed;
}
