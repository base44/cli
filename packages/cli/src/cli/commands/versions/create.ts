import type { Command } from "commander";
import {
  concurrencyOption,
  gitHashOption,
  outputDirOption,
} from "@/cli/commands/versions/options.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { resolveProvenanceCommit } from "@/core/site/index.js";
import {
  collectBuildOutput,
  collectResources,
  createVersion,
  requireOutputDir,
  resolvePublishTarget,
} from "@/core/version/index.js";

interface CreateOptions {
  outputDir?: string;
  gitHash?: string;
  concurrency?: number;
}

/** Record a build that already exists. No build of its own, and no deploy. */
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
    .addOption(outputDirOption())
    .addOption(gitHashOption())
    .addOption(concurrencyOption())
    .action(createAction);
}
