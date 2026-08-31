import { resolve } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import { InvalidArgumentError, Option } from "commander";
import { maybeBuildBeforeDeploy } from "@/cli/commands/project/site-build.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { ConfigNotFoundError, InvalidInputError } from "@/core/errors.js";
import { readProjectSettings } from "@/core/project/index.js";
import type { ProjectWithPaths } from "@/core/project/types.js";
import {
  DEFAULT_UPLOAD_CONCURRENCY,
  deploySite,
  deployToDeployments,
  MAX_UPLOAD_CONCURRENCY,
  resolveGitHash,
  usesDeploymentsApi,
} from "@/core/site/index.js";
import { isGitCommitHash } from "@/core/utils/git.js";

interface DeployOptions {
  yes?: boolean;
  build?: boolean;
  gitHash?: string;
  concurrency?: number;
}

async function deployAction(
  ctx: CLIContext,
  options: DeployOptions,
): Promise<RunCommandResult> {
  const { isNonInteractive } = ctx;
  if (isNonInteractive && !options.yes) {
    throw new InvalidInputError("--yes is required in non-interactive mode");
  }

  // Config only: a site deploy reads none of the project's resource files, so an
  // invalid one must not fail it.
  const project = await readProjectSettings();

  await maybeBuildBeforeDeploy(ctx, project, options.build);

  if (!options.yes) {
    const outputDirectory = project.site?.outputDirectory;
    const shouldDeploy = await confirm({
      message: outputDirectory
        ? `Deploy site from ${outputDirectory}?`
        : "Deploy site?",
    });

    if (isCancel(shouldDeploy) || !shouldDeploy) {
      return { outroMessage: "Deployment cancelled" };
    }
  }

  return await usesDeploymentsApi(project.root)
    ? await deployToDeploymentsApi(ctx, project, options)
    : await deployTarball(ctx, project);
}

/**
 * Run the deploy behind a spinner, streaming its stages into the spinner
 * message. Asset counts are also kept for a summary line, since the spinner only
 * ever shows the latest one, and warnings are held back so they land after the
 * task instead of being overwritten by it.
 */
async function deployToDeploymentsApi(
  ctx: CLIContext,
  project: ProjectWithPaths,
  options: DeployOptions,
): Promise<RunCommandResult> {
  const { runTask, log, jsonMode } = ctx;
  const projectRoot = project.root;
  const gitHash = await resolveGitHash(projectRoot, options.gitHash);
  const progressLines: string[] = [];
  const warnings: string[] = [];

  const { deploymentId } = await runTask(
    "Deploying site...",
    async (updateMessage) =>
      await deployToDeployments({
        projectRoot,
        // Null is fine: a build carrying a worker brings its own assets
        // directory, so it needs no site.outputDirectory.
        outputDir: siteOutputDir(project),
        gitHash,
        concurrency: options.concurrency,
        progress: {
          onWarning: (message) => {
            warnings.push(message);
          },
          onAssets: ({ totalAssets, newAssets }) => {
            const line = `Found ${totalAssets} static assets (${newAssets} new)`;
            progressLines.push(line);
            updateMessage(line);
          },
          onAssetUpload: ({ uploadedFiles, totalFiles }) => {
            updateMessage(`Uploaded ${uploadedFiles} of ${totalFiles} assets`);
          },
          onWorker: ({ moduleCount }) => {
            updateMessage(`Deploying worker (${moduleCount} modules)…`);
          },
        },
      }),
    { successMessage: "Site deployed", errorMessage: "Site deploy failed" },
  );

  for (const line of progressLines) {
    log.message(theme.styles.dim(line));
  }
  for (const warning of warnings) {
    log.warn(warning);
  }

  // No URL: what production serves is decided when the app is published from
  // the builder, not by this deploy.
  return {
    outroMessage: `Deployment ${deploymentId} (commit ${gitHash.slice(0, 12)})`,
    stdout: jsonMode
      ? `${JSON.stringify({ deploymentId, gitHash }, null, 2)}\n`
      : undefined,
  };
}

async function deployTarball(
  { runTask }: CLIContext,
  project: ProjectWithPaths,
): Promise<RunCommandResult> {
  const outputDir = siteOutputDir(project);
  if (!outputDir) {
    throw new ConfigNotFoundError("No site configuration found.", {
      hints: [
        {
          message:
            'Add \'site.outputDirectory\' to your config.jsonc (e.g., "site": { "outputDirectory": "dist" })',
        },
      ],
    });
  }

  const { appUrl } = await runTask(
    "Creating archive and deploying site...",
    async () => await deploySite(outputDir),
    {
      successMessage: "Site deployed successfully",
      errorMessage: "Deployment failed",
    },
  );

  return { outroMessage: `Visit your site at: ${appUrl}` };
}

/** The configured static output directory, absolute; null when unconfigured. */
function siteOutputDir(project: ProjectWithPaths): string | null {
  const outputDirectory = project.site?.outputDirectory;
  return outputDirectory ? resolve(project.root, outputDirectory) : null;
}

export function getSiteDeployCommand(): Command {
  return new Base44Command("deploy")
    .description("Deploy built site files to Base44 hosting")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--build", "Build the site before deploying (skips the prompt)")
    .option("--no-build", "Deploy without building (skips the prompt)")
    .addOption(
      new Option(
        "--git-hash <hash>",
        "Commit the build came from (defaults to the checkout's HEAD)",
      ).argParser(parseGitHash),
    )
    .addOption(
      new Option("--concurrency <n>", "Parallel asset uploads")
        .default(DEFAULT_UPLOAD_CONCURRENCY)
        .argParser(parseConcurrency),
    )
    .action(deployAction);
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
    parsed > MAX_UPLOAD_CONCURRENCY
  ) {
    throw new InvalidArgumentError(
      `Expected a whole number between 1 and ${MAX_UPLOAD_CONCURRENCY}.`,
    );
  }
  return parsed;
}
