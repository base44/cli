import type { Command } from "commander";
import { InvalidArgumentError, Option } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { resolveProvenanceCommit } from "@/core/site/index.js";
import { isGitCommitHash } from "@/core/utils/git.js";
import {
  collectBuildOutput,
  collectResources,
  createVersion,
  DEFAULT_VERSION_UPLOAD_CONCURRENCY,
  MAX_VERSION_UPLOAD_CONCURRENCY,
  requireOutputDir,
  resolvePublishTarget,
} from "@/core/version/index.js";

interface CreateOptions {
  outputDir?: string;
  gitHash?: string;
  concurrency?: number;
}

/**
 * Record a build that already exists. No build of its own and no deploy —
 * a version is a blueprint, and one can sit unpublished for as long as it likes.
 */
async function createAction(
  { runTask, jsonMode, app }: CLIContext,
  options: CreateOptions,
): Promise<RunCommandResult> {
  const target = await resolvePublishTarget(app?.projectRoot, {
    outputDir: options.outputDir,
  });
  const gitHash = await resolveProvenanceCommit(target.root, options.gitHash);

  const version = await runTask(
    "Creating version...",
    async (updateMessage) =>
      await createVersion(
        {
          files: await collectBuildOutput(requireOutputDir(target)),
          ...(await collectResources(target.configDir, target)),
        },
        {
          sourceCommit: gitHash,
          concurrency: options.concurrency,
          progress: {
            onDeclared: ({ fileCount, owedFiles }) =>
              updateMessage(`Uploading ${owedFiles} of ${fileCount} files`),
            onUpload: ({ uploadedFiles, totalFiles }) =>
              updateMessage(`Uploaded ${uploadedFiles} of ${totalFiles} files`),
          },
        },
      ),
    {
      successMessage: "Version created",
      errorMessage: "Create version failed",
    },
  );

  return {
    outroMessage: `Version ${version.versionId} (${version.manifestHash})`,
    stdout: jsonMode ? `${JSON.stringify(version, null, 2)}\n` : undefined,
  };
}

export function getVersionCreateCommand(): Command {
  return new Base44Command("create")
    .description("Record the built output as a version, without deploying it")
    .option(
      "--output-dir <dir>",
      "Build output directory (defaults to the project's, else dist)",
    )
    .addOption(
      new Option(
        "--git-hash <hash>",
        "Commit the build came from (defaults to the checkout's HEAD)",
      ).argParser((value: string) => {
        if (!isGitCommitHash(value)) {
          throw new InvalidArgumentError(
            "Expected a git commit hash (7-64 hex chars).",
          );
        }
        return value;
      }),
    )
    .addOption(
      new Option("--concurrency <n>", "Parallel file uploads")
        .default(DEFAULT_VERSION_UPLOAD_CONCURRENCY)
        .argParser((value: string) => {
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
        }),
    )
    .action(createAction);
}
