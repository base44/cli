import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { InvalidInputError } from "@/core/errors.js";
import { getAppContext } from "@/core/project/app-config.js";
import type { FinalizePayload } from "./api.js";
import { createDeployment, finalizeDeployment } from "./api.js";
import { resolveFullStackBuild } from "./full-stack.js";
import { buildAssetManifest } from "./manifest.js";
import type {
  AssetManifestResult,
  CreateDeploymentRequest,
  DeploymentProgress,
  WorkerModule,
} from "./schema.js";
import { uploadDeploymentAssets } from "./upload.js";
import type { ResolvedWranglerConfig } from "./wrangler-config.js";

type WorkerConfig = NonNullable<CreateDeploymentRequest["config"]>;

interface WorkerBuild {
  config: WorkerConfig;
  modules: WorkerModule[];
  /** The worker's own assets directory, which supersedes site.outputDirectory. */
  assetsDir: string | null;
}

const NO_ASSETS: AssetManifestResult = { manifest: {}, filesByHash: new Map() };

const DEPLOYMENTS_API_ENV = "BASE44_DEPLOYMENTS_API";

/**
 * Internal gate for the deployments-API lane — static output and full-stack
 * builds alike, neither user-facing yet. With it off `site deploy` takes the
 * legacy tar.gz upload and the flags that only mean something on this lane are
 * not registered at all, so the whole lane is one env var away from existing.
 *
 * It is the only thing that selects the transport: whether the build carries a
 * worker changes what `deployToDeployments()` sends, never which flow runs.
 */
export function deploymentsApiEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[DEPLOYMENTS_API_ENV];
  return value === "1" || value === "true";
}

/**
 * Deploy a build for a commit through the deployments API: hash its static
 * assets into a manifest, create the deployment at the commit's address, upload
 * whichever assets the server asks for, and finalize.
 *
 * Whether the build carries a user worker changes only what this sends. A
 * worker's config goes on the create call — which is also what makes the server
 * store the assets on Cloudflare rather than S3 — and its modules complete the
 * deployment at finalize; with no worker, create carries no config and the
 * index.html sentinel completes it.
 *
 * Builds only — nothing here publishes. What production serves is decided by
 * the platform publish flow.
 */
export async function deployToDeployments(options: {
  projectRoot: string;
  /** Static output directory from the app config, when it has one. */
  outputDir: string | null;
  gitHash: string;
  concurrency?: number;
  progress?: DeploymentProgress;
}): Promise<{ deploymentId: string; gitHash: string }> {
  const { projectRoot, outputDir, gitHash, concurrency, progress } = options;

  const worker = await resolveWorkerBuild(projectRoot, progress);
  const assetsDir = worker ? worker.assetsDir : outputDir;
  const assets = assetsDir
    ? await buildAssetManifest(assetsDir, getAppContext().id)
    : NO_ASSETS;

  // Checked before the create call so a build that cannot be completed fails
  // before any upload work — the bytes are only read if finalize carries them.
  if (!worker) {
    requireStaticEntryPoint(assetsDir, assets);
  }

  const created = await createDeployment({
    git_hash: gitHash,
    config: worker?.config,
    asset_manifest: assets.manifest,
  });

  const completionJwt = await uploadDeploymentAssets(
    created.assetUploads,
    assets,
    { concurrency, progress },
  );

  const completion: FinalizePayload = worker
    ? { kind: "worker", modules: worker.modules, completionJwt }
    : await resolveStaticCompletion(assetsDir, assets, created.indexHtmlStaged);

  if (completion.kind === "worker") {
    progress?.onWorker?.({ moduleCount: completion.modules.length });
  }
  const finalized = await finalizeDeployment(
    created.deploymentId,
    created.sessionId,
    completion,
  );

  return { deploymentId: finalized.deploymentId, gitHash };
}

async function resolveWorkerBuild(
  projectRoot: string,
  progress?: DeploymentProgress,
): Promise<WorkerBuild | null> {
  const built = await resolveFullStackBuild(projectRoot);
  if (!built) {
    return null;
  }

  const { config, modules, assetsDir } = built;
  return {
    config: {
      main: config.main,
      compatibility_date: config.compatibilityDate,
      compatibility_flags: config.compatibilityFlags,
      assets: buildAssetsConfig(config.assetsConfig, progress),
    },
    modules,
    assetsDir,
  };
}

/**
 * A static build is addressed by its entry point, so one without an index.html
 * at its root is broken — or the configured outputDirectory points at the wrong
 * place. Checked against the manifest, which is already built.
 */
function requireStaticEntryPoint(
  assetsDir: string | null,
  assets: AssetManifestResult,
): string {
  if (!assetsDir || !assets.manifest["/index.html"]) {
    throw await missingIndexHtmlError(assetsDir, assets);
  }
  return assetsDir;
}

/**
 * How a static build completes. A current server stages the entry point with
 * the other presigned uploads and copies it in, so finalize sends nothing;
 * older ones still expect the bytes in the request body.
 */
async function resolveStaticCompletion(
  assetsDir: string | null,
  assets: AssetManifestResult,
  indexHtmlStaged: boolean,
): Promise<FinalizePayload> {
  if (indexHtmlStaged) return { kind: "static-staged" };
  const dir = requireStaticEntryPoint(assetsDir, assets);
  return {
    kind: "static-inline",
    indexHtml: new Uint8Array(await readFile(join(dir, "index.html"))),
  };
}

/** Same wording the legacy tar.gz upload uses for an unbuilt project. */
const BUILD_FIRST_HINT = {
  message:
    "Run 'base44 build' first (it injects your app id; a bare 'npm run build' does not)",
} as const;

/**
 * The redirect file as it appears in copy, spelled out rather than taken from
 * `WRANGLER_REDIRECT_PATH` in `wrangler-config.ts`: that constant is built with
 * `join()` for touching the file, so it would read with backslashes on Windows.
 */
const REDIRECT_FILE_IN_COPY = ".wrangler/deploy/config.json";

/**
 * Says what the build did not emit without naming the worker — user-facing copy
 * says "site" and does not make the distinction (see docs/deployments.md).
 */
const NO_ARTIFACT_HINT = {
  message: `A build that emits ${REDIRECT_FILE_IN_COPY} deploys its server too; without one, only the files in the output directory are deployed.`,
} as const;

/**
 * Why there is no index.html to finalize with. One message used to cover every
 * one of these — a missing output directory, an empty one, and one whose entry
 * point sits a level down all read as "No index.html found ... a static site
 * needs one", which says nothing about which of the three happened and asserts
 * a site type the caller never chose. The first two also restore the guard
 * rails the legacy tar.gz upload has and this lane dropped.
 *
 * Diagnosis only: the throw itself, and the `INVALID_INPUT` code the platform
 * keys its publish alerting on, are unchanged.
 */
async function missingIndexHtmlError(
  assetsDir: string | null,
  assets: AssetManifestResult,
): Promise<InvalidInputError> {
  if (!assetsDir) {
    return new InvalidInputError(
      `No site output to deploy: this build emitted no ${REDIRECT_FILE_IN_COPY}, and the project config sets no 'site.outputDirectory' to fall back to.`,
      {
        hints: [
          {
            message:
              'Add \'site.outputDirectory\' to your config.jsonc (e.g., "site": { "outputDirectory": "dist" })',
          },
        ],
      },
    );
  }

  if (!(await pathExists(assetsDir))) {
    return new InvalidInputError(
      `Output directory does not exist: ${assetsDir}. Make sure to build your project first.`,
      { hints: [BUILD_FIRST_HINT] },
    );
  }

  const paths = Object.keys(assets.manifest);
  if (paths.length === 0) {
    return new InvalidInputError(
      `No files found in output directory: ${assetsDir}. Make sure to build your project first.`,
      { hints: [BUILD_FIRST_HINT] },
    );
  }

  // Populated, but the entry point is not where finalize reads it from. An
  // index.html one level down is the signature of a build that split its
  // output client/server without emitting the artifact that would have shipped
  // the server, so name the ones we found rather than leave it to be guessed.
  const nested = paths.filter((path) => path.endsWith("/index.html")).sort();

  return new InvalidInputError(
    `No index.html at the root of "${assetsDir}" — the build emitted ${paths.length} ${paths.length === 1 ? "file" : "files"} there, none of them an entry point.`,
    {
      hints: [
        ...(nested.length > 0
          ? [
              {
                message: `Found an index.html deeper in the output: ${nested.join(", ")} — point 'site.outputDirectory' at that directory, or have the build emit an entry point at the root.`,
              },
            ]
          : []),
        NO_ARTIFACT_HINT,
      ],
    },
  );
}

/**
 * The subset of the wrangler assets config the deployments API accepts. The
 * unsupported fields would change runtime behavior if dropped silently, so each
 * drop is surfaced as a warning.
 */
function buildAssetsConfig(
  assetsConfig: ResolvedWranglerConfig["assetsConfig"],
  progress?: DeploymentProgress,
): WorkerConfig["assets"] {
  if (!assetsConfig) return null;

  if (assetsConfig.headers || assetsConfig.redirects) {
    progress?.onWarning?.(
      "_headers/_redirects files are not supported yet and were ignored for this deploy.",
    );
  }

  let runWorkerFirst: boolean | undefined;
  if (Array.isArray(assetsConfig.runWorkerFirst)) {
    progress?.onWarning?.(
      "'run_worker_first' route patterns are not supported yet and were ignored for this deploy.",
    );
  } else {
    runWorkerFirst = assetsConfig.runWorkerFirst;
  }

  return {
    html_handling: assetsConfig.htmlHandling,
    not_found_handling: assetsConfig.notFoundHandling,
    run_worker_first: runWorkerFirst,
  };
}
