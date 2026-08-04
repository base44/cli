import { resolve } from "node:path";
import { confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import { InvalidArgumentError, Option } from "commander";
import { maybeBuildBeforeDeploy } from "@/cli/commands/project/site-build.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { ConfigNotFoundError, InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/index.js";
import {
  DEFAULT_UPLOAD_CONCURRENCY,
  deploySite,
  deployStaticSite,
  MAX_UPLOAD_CONCURRENCY,
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

  const { project } = await readProjectConfig();

  const outputDirectory = project.site?.outputDirectory;

  if (!outputDirectory) {
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
      message: `Deploy site from ${outputDirectory}?`,
    });

    if (isCancel(shouldDeploy) || !shouldDeploy) {
      return { outroMessage: "Deployment cancelled" };
    }
  }

  await maybeBuildBeforeDeploy(ctx, project, options.build);

  const outputDir = resolve(project.root, outputDirectory);

  // A commit means a deployments-API deploy: a deployment is addressed by the
  // commit that produced the build. Without one, ship the legacy tar.gz upload.
  const { gitHash, concurrency } = options;

  return gitHash
    ? await deployToDeploymentsApi(ctx, outputDir, gitHash, concurrency)
    : await deployTarball(ctx, outputDir);
}

async function deployToDeploymentsApi(
  { runTask, log, jsonMode }: CLIContext,
  outputDir: string,
  gitHash: string,
  concurrency?: number,
): Promise<RunCommandResult> {
  const progressLines: string[] = [];

  const { deploymentId } = await runTask(
    "Deploying site...",
    async (updateMessage) =>
      await deployStaticSite({
        outputDir,
        gitHash,
        concurrency,
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
    { successMessage: "Site deployed", errorMessage: "Site deploy failed" },
  );

  for (const line of progressLines) {
    log.message(theme.styles.dim(line));
  }

  // A build has no URL of its own: what production serves is decided when the
  // app is published from the builder, not by this deploy.
  return {
    outroMessage: `Deployment ${deploymentId} (commit ${gitHash.slice(0, 12)})`,
    stdout: jsonMode
      ? `${JSON.stringify({ deploymentId, gitHash }, null, 2)}\n`
      : undefined,
  };
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

export function getSiteDeployCommand(): Command {
  const command = new Base44Command("deploy")
    .description("Deploy built site files to Base44 hosting")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--build", "Build the site before deploying (skips the prompt)")
    .option("--no-build", "Deploy without building (skips the prompt)");

  // Only registered on the enabled lane, so with the gate off the flag is
  // absent from --help and rejected as an unknown option.
  if (staticDeploymentsEnabled()) {
    command.addOption(
      new Option(
        "--git-hash <hash>",
        "Commit the build came from — deploys through the deployments API",
      ).argParser((value) => {
        if (!isGitCommitHash(value)) {
          throw new InvalidArgumentError(
            "Expected a git commit hash (7-64 hex chars).",
          );
        }
        return value;
      }),
    );
    command.addOption(
      new Option("--concurrency <n>", "Parallel asset uploads")
        .default(DEFAULT_UPLOAD_CONCURRENCY)
        .argParser(parseConcurrency),
    );
  }

  return command.action(deployAction);
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

function staticDeploymentsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.BASE44_STATIC_DEPLOYMENTS;
  return value === "1" || value === "true";
}
