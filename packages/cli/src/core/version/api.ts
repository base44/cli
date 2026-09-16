import type { KyResponse } from "ky";
import type { ZodType } from "zod";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import { uploadPresignedAssets } from "@/core/site/upload.js";
import type {
  ArtifactSet,
  CreateVersionProgress,
  CreateVersionResponse,
  EnvironmentResponse,
} from "@/core/version/schema.js";
import {
  CreateVersionResponseSchema,
  DeclareVersionResponseSchema,
  EnvironmentResponseSchema,
} from "@/core/version/schema.js";

/**
 * Measured on the sandbox's pipe: at 3, a 25.5k-asset app needed ~930s of the
 * ~450s a build leaves. 16 failed a degraded pipe on 2026-07-02.
 */
export const DEFAULT_VERSION_UPLOAD_CONCURRENCY = 8;
export const MAX_VERSION_UPLOAD_CONCURRENCY = 16;

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

async function patch(
  path: string,
  json: unknown,
  doing: string,
): Promise<KyResponse> {
  try {
    return await getAppClient().patch(path, { json, timeout: 180_000 });
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
 * Declare the artifact set, upload what it names, and commit the version. In
 * that order: an interrupted run leaves staged objects that expire, never a
 * version naming files that are not there.
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
          static_bundle: artifacts.files.map(({ path, size, digest }) => ({
            path,
            size,
            digest,
          })),
          entities: artifacts.entities,
          agents: artifacts.agents,
          // One commit: an app's frontend and backend are the same app at the
          // same source.
          source_commit: options.sourceCommit,
        },
        "declaring a version",
      )
    ).json(),
    "declare",
  );

  options.progress?.onDeclared?.({
    fileCount: artifacts.files.length,
    owedFiles: declared.uploads.length,
  });

  await uploadPresignedAssets(
    declared.uploads,
    {
      manifest: Object.fromEntries(
        artifacts.files.map((file) => [
          file.path,
          { hash: file.digest, size: file.size },
        ]),
      ),
      filesByHash: new Map(
        artifacts.files.map((file) => [
          file.digest,
          // No contentType: the PUT echoes the one the server signed into the
          // URL, and deriving a second opinion here is how they diverge.
          {
            absolutePath: file.absolutePath,
            hash: file.digest,
            size: file.size,
          },
        ]),
      ),
    },
    {
      concurrency: options.concurrency ?? DEFAULT_VERSION_UPLOAD_CONCURRENCY,
      onProgress: options.progress?.onUpload,
    },
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
 * Point an environment at a recorded version.
 *
 * An environment serves one version, so making a version live is editing that
 * pointer — there is no deployment to create. Pointing it at an older version is
 * the rollback.
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
      )
    ).json(),
    "environment",
  );
}
