import { confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import { InvalidArgumentError, Option } from "commander";
import { maybeBuildBeforeDeploy } from "@/cli/commands/project/site-build.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { ConfigNotFoundError, InvalidInputError } from "@/core/errors.js";
import { readProjectSettings } from "@/core/project/index.js";
import {
  DEFAULT_UPLOAD_CONCURRENCY,
  deploySite,
  deployToDeployments,
  MAX_UPLOAD_CONCURRENCY,
  planAppDeploy,
  resolveGitHash,
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
  const outputDirectory = project.site?.outputDirectory;

  if ((await planAppDeploy(project)).kind === "none") {
    throw new ConfigNotFoundError("No site configuration found.", {
      hints: [
        {
          message:
            'Add \'site.outputDirectory\' to your config.jsonc (e.g., "site": { "outputDirectory": "dist" })',
        },
      ],
    });
  }

  if (!options.yes) {
    const shouldDeploy = await confirm({
      message: outputDirectory
        ? `Deploy site from ${outputDirectory}?`
        : "Deploy site?",
    });

    if (isCancel(shouldDeploy) || !shouldDeploy) {
      return { outroMessage: "Deployment cancelled" };
    }
  }

  await maybeBuildBeforeDeploy(ctx, project, options.build);

  // Planned again: the build may have produced the artifact that decides which
  // transport applies.
  const plan = await planAppDeploy(project);

  switch (plan.kind) {
    case "deployment":
      return await deployToDeploymentsApi(
        ctx,
        project.root,
        plan.outputDir,
        options,
      );
    case "tarball":
      return await deployTarball(ctx, plan.outputDir);
    case "none":
      return { outroMessage: "Nothing to deploy" };
  }
}

/**
 * Run the deploy behind a spinner, streaming its stages into the spinner
 * message. Asset counts are also kept for a summary line, since the spinner only
 * ever shows the latest one, and warnings are held back so they land after the
 * task instead of being overwritten by it.
 */
async function deployToDeploymentsApi(
  ctx: CLIContext,
  projectRoot: string,
  outputDir: string | null,
  options: DeployOptions,
): Promise<RunCommandResult> {
  const { runTask, log } = ctx;
  const gitHash = await resolveGitHash(projectRoot, options.gitHash);
  const progressLines: string[] = [];
  const warnings: string[] = [];

  const { deploymentId } = await runTask(
    "Deploying site...",
    async (updateMessage) =>
      await deployToDeployments({
        projectRoot,
        outputDir,
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

  return deploymentResult(ctx, deploymentId, gitHash);
}

async function deployTarball(
  { runTask }: CLIContext,
  outputDir: string,
): Promise<RunCommandResult> {
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

function deploymentResult(
  { jsonMode }: CLIContext,
  deploymentId: string,
  gitHash: string,
): RunCommandResult {
  // No URL: what production serves is decided when the app is published from
  // the builder, not by this deploy.
  return {
    outroMessage: `Deployment ${deploymentId} (commit ${gitHash.slice(0, 12)})`,
    stdout: jsonMode
      ? `${JSON.stringify({ deploymentId, gitHash }, null, 2)}\n`
      : undefined,
  };
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
