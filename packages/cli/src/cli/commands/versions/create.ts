import type { Command } from "commander";
import {
  concurrencyOption,
  gitHashOption,
  outputDirOption,
  routesFileOption,
} from "@/cli/commands/versions/options.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, requireApp } from "@/cli/utils/index.js";
import { resolveBuildTarget } from "@/core/project/index.js";
import { resolveProvenanceCommit } from "@/core/site/index.js";
import { collectArtifacts, createVersion } from "@/core/version/index.js";

interface CreateOptions {
  outputDir?: string;
  gitHash?: string;
  concurrency?: number;
  routesFile?: string;
}

/** Record a build that already exists. No build of its own, and no deploy. */
async function createAction(
  ctx: CLIContext,
  options: CreateOptions,
): Promise<RunCommandResult> {
  const { runTask, log, jsonMode } = ctx;
  const target = await resolveBuildTarget(requireApp(ctx).projectRoot, {
    outputDir: options.outputDir,
  });
  const gitHash = await resolveProvenanceCommit(target.root, options.gitHash);
  // Held until the spinner stops, so they are not drawn over it.
  const warnings: string[] = [];
  const onWarning = (message: string) => warnings.push(message);

  let version: Awaited<ReturnType<typeof createVersion>>;
  try {
    version = await runTask(
      "Creating version...",
      async (updateMessage) =>
        await createVersion(
          await collectArtifacts(target, {
            routesFile: options.routesFile,
            onWarning,
          }),
          {
            sourceCommit: gitHash,
            concurrency: options.concurrency,
            onWarning,
            progress: {
              onDeclared: ({ fileCount }) =>
                updateMessage(`Uploading ${fileCount} files`),
              onUpload: ({ uploadedFiles, totalFiles }) =>
                updateMessage(
                  `Uploaded ${uploadedFiles} of ${totalFiles} files`,
                ),
            },
          },
        ),
      {
        successMessage: "Version created",
        errorMessage: "Create version failed",
      },
    );
  } finally {
    for (const warning of warnings) {
      log.warn(warning);
    }
  }

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
    .addOption(routesFileOption())
    .action(createAction);
}
