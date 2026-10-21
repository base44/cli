import { resolve } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import { InvalidArgumentError, Option } from "commander";
import { maybeBuildBeforeDeploy } from "@/cli/commands/project/site-build.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, parseGitHash, theme } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import {
  DEFAULT_SITE,
  readProjectSettings,
  siteOrDefault,
} from "@/core/project/index.js";
import type { ProjectWithPaths } from "@/core/project/types.js";
import {
  DEFAULT_UPLOAD_CONCURRENCY,
  deploySite,
  deployToDeployments,
  detectFullStackArtifact,
  MAX_UPLOAD_CONCURRENCY,
  publishDeployment,
  resolveGitHash,
} from "@/core/site/index.js";

interface DeployOptions {
  yes?: boolean;
  build?: boolean;
  gitHash?: string;
  concurrency?: number;
  publish?: boolean;
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

  return deployToDeploymentsApi(ctx, project, options);
}

async function deployToDeploymentsApi(
  ctx: CLIContext,
  project: ProjectWithPaths,
  options: DeployOptions,
): Promise<RunCommandResult> {
  const { runTask, log, jsonMode } = ctx;
  const projectRoot = project.root;
  // First, so a defaulted site block is reported before anything can fail.
  const outputDir = siteOutputDir(project);
  // A static build with no commit behind it keeps the archive upload; a worker
  // build has no archive form, so there the resolver's error stands.
  const gitHash = await resolveGitHash(projectRoot, options.gitHash).catch(
    async (error) => {
      if (await detectFullStackArtifact(projectRoot)) throw error;
      return undefined;
    },
  );
  if (!gitHash) {
    return deployArchive(ctx, outputDir);
  }
  const progressLines: string[] = [];
  const warnings: string[] = [];

  const { deploymentId } = await runTask(
    "Deploying site...",
    async (updateMessage) =>
      await deployToDeployments({
        projectRoot,
        // A build carrying a worker brings its own assets directory instead.
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

  // Deploying is not publishing: this command builds an app's commit, and the
  // platform's own build step is its main caller — for an app the builder
  // manages, production is repointed there, and publishing here would fail it.
  // `base44 deploy` is the door that puts a build live; `--publish` is the same
  // step on demand.
  const published = options.publish
    ? await runTask(
        "Publishing site...",
        async () => await publishDeployment(gitHash),
        { successMessage: "Site published", errorMessage: "Publish failed" },
      )
    : undefined;

  if (published) {
    log.message(
      `${theme.styles.header("App URL")}: ${theme.colors.links(published.appUrl)}`,
    );
  } else {
    log.info(
      "Not published: production still serves its previous build. Run again with --publish to serve this one.",
    );
  }

  return {
    outroMessage: `Deployment ${deploymentId} (commit ${gitHash.slice(0, 12)})`,
    stdout: jsonMode
      ? `${JSON.stringify({ deploymentId, gitHash, published: Boolean(published) }, null, 2)}\n`
      : undefined,
  };
}

async function deployArchive(
  { runTask, log, jsonMode }: CLIContext,
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
  log.warn(
    "No commit found for this build, so it was deployed and published without one. Commit your work to address deployments by it.",
  );

  return {
    outroMessage: `Visit your site at: ${appUrl}`,
    stdout: jsonMode
      ? `${JSON.stringify({ appUrl, published: true }, null, 2)}\n`
      : undefined,
  };
}

function siteOutputDir(project: ProjectWithPaths): string {
  const { outputDirectory = DEFAULT_SITE.outputDirectory } =
    siteOrDefault(project);
  return resolve(project.root, outputDirectory);
}

export function getSiteDeployCommand(): Command {
  return new Base44Command("deploy")
    .description("Deploy built site files to Base44 hosting")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--build", "Build the site before deploying (skips the prompt)")
    .option("--no-build", "Deploy without building (skips the prompt)")
    .option("--publish", "Serve this build in production once it is deployed")
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
