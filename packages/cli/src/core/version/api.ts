import type { KyResponse, RetryOptions } from "ky";
import pMap from "p-map";
import type { ZodType } from "zod";
import { getAppClient } from "@/core/clients/index.js";
import {
  ApiError,
  InternalError,
  SchemaValidationError,
} from "@/core/errors.js";
import { putPresigned } from "@/core/site/upload.js";
import type { ResolvedAssetsConfig } from "@/core/site/wrangler-config.js";
import type {
  ArtifactFile,
  ArtifactSet,
  CreateVersionProgress,
  CreateVersionResponse,
  EnvironmentResponse,
  WorkerModuleArtifact,
} from "@/core/version/schema.js";
import {
  CreateVersionResponseSchema,
  DeclareVersionResponseSchema,
  EnvironmentResponseSchema,
} from "@/core/version/schema.js";

/**
 * Measured on the sandbox's pipe: 3 needed ~930s of the ~450s a build leaves for
 * a 25.5k-asset app; 16 failed a degraded pipe on 2026-07-02.
 */
export const DEFAULT_VERSION_UPLOAD_CONCURRENCY = 8;
export const MAX_VERSION_UPLOAD_CONCURRENCY = 16;

function declaredFile({ path, size, digest }: ArtifactFile) {
  return { path, size, digest };
}

function declaredModule(module: WorkerModuleArtifact) {
  return { ...declaredFile(module), type: module.type };
}

/**
 * Wrangler's own `assets` block, back in its own snake_case.
 *
 * A config that states no setting collapses to `null`, the same as no config at
 * all: a bare `assets: { directory }` and an absent block describe the identical
 * Worker, and recording them apart would split one version into two.
 */
function declaredAssetsConfig(config: ResolvedAssetsConfig | null) {
  const stated = {
    html_handling: config?.htmlHandling ?? null,
    not_found_handling: config?.notFoundHandling ?? null,
    run_worker_first: config?.runWorkerFirst ?? null,
    headers: config?.headers ?? null,
    redirects: config?.redirects ?? null,
  };
  return Object.values(stated).every((v) => v === null) ? null : stated;
}

async function post(
  path: string,
  json: unknown,
  doing: string,
): Promise<KyResponse> {
  try {
    return await getAppClient().post(path, { json, timeout: 180_000 });
  } catch (error) {
    throw await ApiError.fromHttpError(error, doing);
  }
}

/**
 * Ky retries neither PATCH nor a POST by default, and rightly: a repeat is a
 * second request unless something makes it the same one. An idempotency key is
 * exactly that — the server answers a repeated key with the publication it
 * already made — so retrying is only safe WITH one, and this is only ever
 * passed then.
 */
const KEYED_RETRY: RetryOptions = {
  limit: 3,
  methods: ["patch"],
  statusCodes: [408, 500, 502, 503, 504],
  // The case the key exists for, and the one ky skips by default: our own
  // deadline expiring says nothing about whether the server committed. HTTP 408
  // above is the server reporting a timeout; this is the client giving up on a
  // request that may well have landed.
  retryOnTimeout: true,
};

async function patch(
  path: string,
  json: unknown,
  doing: string,
  retry?: RetryOptions,
): Promise<KyResponse> {
  try {
    return await getAppClient().patch(path, {
      json,
      timeout: 180_000,
      ...(retry ? { retry } : {}),
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, doing);
  }
}

function parse<T>(schema: ZodType<T>, body: unknown, what: string): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new SchemaValidationError(
      `Invalid ${what} response from server`,
      result.error,
    );
  }
  return result.data;
}

/**
 * Declare, upload, then commit — in that order, so an interrupted run leaves
 * staged objects that expire rather than a version naming files that are gone.
 */
export async function createVersion(
  artifacts: ArtifactSet,
  options: {
    sourceCommit?: string;
    concurrency?: number;
    progress?: CreateVersionProgress;
  } = {},
): Promise<CreateVersionResponse> {
  const declared = parse(
    DeclareVersionResponseSchema,
    await (
      await post(
        "versions",
        {
          static_bundle: artifacts.files.map(declaredFile),
          ...(artifacts.siteWorker
            ? {
                site_worker: {
                  main: artifacts.siteWorker.main,
                  modules: artifacts.siteWorker.modules.map(declaredModule),
                  assets: artifacts.siteWorker.assets.map(declaredFile),
                  compatibility_date: artifacts.siteWorker.compatibilityDate,
                  compatibility_flags: artifacts.siteWorker.compatibilityFlags,
                  assets_config: declaredAssetsConfig(
                    artifacts.siteWorker.assetsConfig,
                  ),
                },
              }
            : {}),
          entities: artifacts.entities,
          agents: artifacts.agents,
          source_commit: options.sourceCommit,
        },
        "declaring a version",
      )
    ).json(),
    "declare",
  );

  // Paired by POSITION, in the order the server signed them: the three sets have
  // separate namespaces, so a module and an asset may share a path.
  const declaredFiles = [
    ...artifacts.files,
    ...(artifacts.siteWorker?.modules ?? []),
    ...(artifacts.siteWorker?.assets ?? []),
  ];

  options.progress?.onDeclared?.({ fileCount: declaredFiles.length });

  if (declared.uploads.length !== declaredFiles.length) {
    throw new InternalError(
      `Declared ${declaredFiles.length} files but the server signed ${declared.uploads.length} upload URLs.`,
    );
  }
  // Necessary, not sufficient — but it catches an order drift here rather than
  // as an S3 checksum rejection part way through the uploads.
  const drifted = declared.uploads.findIndex(
    (upload, index) => upload.path !== declaredFiles[index].path,
  );
  if (drifted !== -1) {
    throw new InternalError(
      `Upload ${drifted} is signed for ${declared.uploads[drifted].path}, but that slot declared ${declaredFiles[drifted].path}.`,
    );
  }

  let uploadedFiles = 0;
  await pMap(
    declared.uploads,
    async (upload, index) => {
      await putPresigned(upload, declaredFiles[index].absolutePath);
      uploadedFiles++;
      options.progress?.onUpload?.({
        uploadedFiles,
        totalFiles: declared.uploads.length,
      });
    },
    { concurrency: options.concurrency ?? DEFAULT_VERSION_UPLOAD_CONCURRENCY },
  );

  return parse(
    CreateVersionResponseSchema,
    await (
      await post(
        `versions/${encodeURIComponent(declared.sessionId)}/finalize`,
        {},
        "creating a version",
      )
    ).json(),
    "create version",
  );
}

/**
 * Point an environment at a recorded version. An environment serves one version,
 * so this is a pointer edit, not a deployment — and an older version is the
 * rollback.
 */
export async function setEnvironmentVersion(
  environment: string,
  versionId: string,
  options: { idempotencyKey?: string } = {},
): Promise<EnvironmentResponse> {
  return parse(
    EnvironmentResponseSchema,
    await (
      await patch(
        `environments/${encodeURIComponent(environment)}`,
        {
          version_id: versionId,
          ...(options.idempotencyKey
            ? { idempotency_key: options.idempotencyKey }
            : {}),
        },
        "setting the environment's version",
        // Same body, same key, so a lost response is replayed into the answer
        // the server already committed rather than reported as a failure.
        options.idempotencyKey ? KEYED_RETRY : undefined,
      )
    ).json(),
    "environment",
  );
}
