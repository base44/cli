import type { KyResponse } from "ky";
import type { ZodType } from "zod";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import { uploadPresignedAssets } from "@/core/site/upload.js";
import type {
  ArtifactSet,
  CreateVersionProgress,
  CreateVersionResponse,
  DeployVersionResponse,
} from "@/core/version/schema.js";
import {
  CreateVersionResponseSchema,
  DeclareVersionResponseSchema,
  DeployVersionResponseSchema,
} from "@/core/version/schema.js";

/**
 * Measured on the sandbox's pipe: a 25.5k-asset app moved 27 assets/s at 3,
 * needing ~930s of the ~450s a build leaves — SIGKILLed mid-upload every time.
 * 8 is the rate the python driver it replaced already sustained to the same
 * bucket, and 16 failed a degraded pipe on 2026-07-02.
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
 * Declare the artifact set, upload what it names, and commit the version.
 *
 * Three calls, in that order and no other: nothing is recorded until the bytes
 * are in place, so an interrupted run leaves staged objects that expire rather
 * than a version naming files that are not there.
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
          source_commit: options.sourceCommit,
          frontend_commit: options.sourceCommit,
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
          {
            absolutePath: file.absolutePath,
            hash: file.digest,
            size: file.size,
            // Signed into the URL by the server and echoed back on the upload,
            // so this value is never the one the PUT sends.
            contentType: "application/octet-stream",
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
 * Serve a recorded version. One POST, and the body carries a target name and a
 * retry key — everything else is the platform's to resolve.
 */
export async function deployVersion(
  versionId: string,
  options: { target?: string; idempotencyKey?: string } = {},
): Promise<DeployVersionResponse> {
  return parse(
    DeployVersionResponseSchema,
    await (
      await post(
        `versions/${encodeURIComponent(versionId)}/deployments`,
        {
          ...(options.target ? { target: options.target } : {}),
          ...(options.idempotencyKey
            ? { idempotency_key: options.idempotencyKey }
            : {}),
        },
        "deploying a version",
      )
    ).json(),
    "deploy",
  );
}
