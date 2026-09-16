import { z } from "zod";

/**
 * A file the build produced.
 *
 * `digest` is a full sha256 over the bytes — artifact identity, signed into the
 * upload URL so S3 refuses any other body. Not `hashAsset`, which truncates
 * sha256(app id ‖ bytes) to key a provider's asset cache; conflating the two
 * gives a file that uploads fine and never dedupes.
 */
export interface ArtifactFile {
  /** Build-relative, forward slashes, no leading "/". */
  path: string;
  absolutePath: string;
  size: number;
  digest: string;
}

/**
 * The app's own server, when the framework built one.
 *
 * Its modules are files exactly like the frontend's, in their own namespace —
 * `index.js` here is not `index.js` there — plus the settings they were built
 * to run under, which the platform treats as part of the Worker's identity.
 */
export interface SiteWorkerArtifact {
  main: string;
  modules: ArtifactFile[];
  compatibilityDate: string | null;
  compatibilityFlags: string[];
  /** Where the frontend is, for a full-stack build: the Worker's own assets
   * directory, never the project's `site.outputDirectory`. */
  assetsDir: string | null;
}

/** Everything one build produced, as the create-version call describes it. */
export interface ArtifactSet {
  files: ArtifactFile[];
  /** Absent for an app with no server of its own — almost every app. */
  siteWorker?: SiteWorkerArtifact;
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
    /** The identity: unchanged across two builds means unchanged content. */
    manifest_hash: z.string(),
  })
  .transform((data) => ({
    versionId: data.version_id,
    manifestHash: data.manifest_hash,
  }));

export type CreateVersionResponse = z.infer<typeof CreateVersionResponseSchema>;

export const EnvironmentResponseSchema = z
  .object({
    name: z.string(),
    version_id: z.string(),
    manifest_hash: z.string(),
    deployment_id: z.string(),
  })
  .transform((data) => ({
    name: data.name,
    versionId: data.version_id,
    manifestHash: data.manifest_hash,
    deploymentId: data.deployment_id,
  }));

export type EnvironmentResponse = z.infer<typeof EnvironmentResponseSchema>;
