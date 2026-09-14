import { z } from "zod";

/**
 * A file the build produced, as the version plane names it.
 *
 * `digest` is a FULL sha256 over the file's bytes — artifact identity, and what
 * the platform signs into the upload URL so S3 refuses any other body. It is not
 * {@link import("@/core/site/manifest.js").hashAsset}, which is a 32-hex
 * truncation of sha256(app id ‖ bytes) and exists to key a provider's asset
 * cache. Different purpose, different moment, different value: conflating them
 * produces a file that uploads fine and never dedupes, or a digest check that
 * fails on a correct file.
 */
export interface ArtifactFile {
  /** Build-relative, forward slashes, no leading "/". */
  path: string;
  absolutePath: string;
  size: number;
  digest: string;
}

/** Everything one build produced, as the create-version call describes it. */
export interface ArtifactSet {
  files: ArtifactFile[];
  /** Raw payloads by name. The server normalizes and hashes them. */
  entities: Record<string, unknown>;
  agents: Record<string, unknown>;
}

export interface CreateVersionProgress {
  onDeclared?: (info: { fileCount: number; owedFiles: number }) => void;
  onUpload?: (progress: { uploadedFiles: number; totalFiles: number }) => void;
}

export const DeclareVersionResponseSchema = z
  .object({
    session_id: z.string(),
    uploads: z.array(
      z.object({
        path: z.string(),
        url: z.string(),
        content_type: z.string(),
        content_length: z.number(),
        checksum_sha256: z.string(),
      }),
    ),
  })
  .transform((data) => ({
    sessionId: data.session_id,
    uploads: data.uploads.map((upload) => ({
      path: upload.path,
      url: upload.url,
      contentType: upload.content_type,
      contentLength: upload.content_length,
      checksumSha256: upload.checksum_sha256,
    })),
  }));

export const CreateVersionResponseSchema = z
  .object({
    version_id: z.string(),
    manifest_hash: z.string(),
    deduplicated: z.boolean(),
  })
  .transform((data) => ({
    versionId: data.version_id,
    manifestHash: data.manifest_hash,
    deduplicated: data.deduplicated,
  }));

export type CreateVersionResponse = z.infer<typeof CreateVersionResponseSchema>;

export const DeployVersionResponseSchema = z
  .object({
    deployment_id: z.string(),
    manifest_hash: z.string(),
    revision: z.number(),
  })
  .transform((data) => ({
    deploymentId: data.deployment_id,
    manifestHash: data.manifest_hash,
    revision: data.revision,
  }));

export type DeployVersionResponse = z.infer<typeof DeployVersionResponseSchema>;
