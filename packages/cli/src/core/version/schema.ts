import type { ShardWrapper } from "@base44/functions-compiler";
import { z } from "zod";
import type { ModuleType } from "@/core/site/schema.js";
import type { ResolvedAssetsConfig } from "@/core/site/wrangler-config.js";

/**
 * A file the build produced. `digest` is a full sha256, signed into the upload
 * URL so S3 refuses any other body — NOT `hashAsset`, which truncates
 * sha256(app id ‖ bytes) to key a provider cache. Conflating them gives a file
 * that uploads fine and never dedupes.
 */
export interface ArtifactFile {
  /** Build-relative, forward slashes, no leading "/". */
  path: string;
  absolutePath: string;
  size: number;
  digest: string;
}

/** One of the Worker's own modules. Their own namespace: `index.js` as a module
 * is not `index.js` as an asset. */
export interface WorkerModuleArtifact extends ArtifactFile {
  /**
   * How the runtime hands this module to its importer. The SAME bytes are a
   * string under `text` and an ArrayBuffer under `data`, so this is a setting
   * rather than a fact about the file — which is why it travels beside the
   * digest instead of being re-derived from the path.
   */
  type: ModuleType;
}

/**
 * The app's own server. Its presence is what says the Worker SERVES the set's
 * assets, rather than the platform serving them from S3; the settings below are
 * part of the Worker's identity, not metadata.
 */
export interface SiteWorkerArtifact {
  main: string;
  modules: WorkerModuleArtifact[];
  compatibilityDate: string | null;
  compatibilityFlags: string[];
  /**
   * What happens to a request before this Worker runs — whether it runs at all,
   * which asset a path resolves to, what a miss gets. Not the assets' config and
   * not the Worker's: it decides how the two are routed between. Two builds
   * differing only here are different Workers and must not record as one.
   */
  servingConfig: ResolvedAssetsConfig | null;
}

/**
 * One compiled Worker shard of the app's backend functions. The module is held
 * in memory: it is what the compiler returned, not a file the build left.
 */
export interface BackendBundleArtifact {
  module: Uint8Array;
  size: number;
  digest: string;
  /** `entry` is the one the compiler was given — flat `main.ts`, or the
   * function's real path when it reaches files beside it. `source` is the entry
   * file as written, not as compiled. */
  functions: { name: string; entry: string; source: string }[];
  /** The compiler's own account of what it wrapped the functions in, carried
   * as it said it — the platform deploys the module under what it states. */
  wrapper: ShardWrapper;
}

/**
 * One actor, compiled on its own: a Durable Object Worker of its own, never a
 * shard. Its name is its folder's, and also the class the module exports.
 */
export interface ActorArtifact {
  name: string;
  /** Always `base44/actors/<name>/entry.ts`, an `entry.js` included: the path
   * is how the compiler knows the entry is an actor. */
  entry: string;
  /** The entry file as written, not as compiled. */
  source: string;
  module: Uint8Array;
  size: number;
  digest: string;
  /** The static-egress contract the module was compiled for. */
  staticEgress: string;
}

/** Everything one build produced, as the create-version call describes it. */
export interface ArtifactSet {
  /** The app's files. Who serves them is what `siteWorker` says. */
  assets: ArtifactFile[];
  /** Absent for an app with no server of its own — almost every app. */
  siteWorker?: SiteWorkerArtifact;
  /** Always sent, empty when the app has none: an absent list tells the
   * platform this producer cannot describe functions, and it refuses that for
   * an app that has them. */
  backendBundles: BackendBundleArtifact[];
  /** Always sent, empty when the app has none, for the same reason. */
  actors: ActorArtifact[];
  /** Raw payloads by name. The server normalizes and hashes them. */
  entities: Record<string, unknown>;
  agents: Record<string, unknown>;
  /** The text of `mcp/config.json` as written, `""` when the app has none.
   * Always sent, for the reason `backendBundles` is. */
  mcpConfig: string;
  /** Each `agent-skills/<name>.md` as written, by skill name, `{}` when the app
   * has none. Always sent, for the reason `backendBundles` is. */
  agentSkills: Record<string, string>;
  /** Each `emails/<Name>.html` as written, by name, `{}` when the app has none.
   * Always sent, for the reason `backendBundles` is. */
  emails: Record<string, string>;
  /** Each `workflows/<key>.jsonc` as written, parsed, by file key, `{}` when the
   * app has none. Always sent, for the reason `backendBundles` is. */
  workflows: Record<string, unknown>;
  /** The app's routes. Absent when nothing named them and its routes are not
   * files this CLI can read: the platform then has no account of them. */
  routes?: RoutesArtifact;
  /** The build's private source maps, from `.base44/source-maps/manifest.json`.
   * Absent when the build left no manifest of its own (none, unreadable, or an
   * earlier build's), so a build without one sends exactly what it always did;
   * empty when it did and no map could be declared. */
  sourceMaps?: SourceMapArtifact[];
}

/**
 * A private source map the build left beside its output, never inside it. Stored
 * by the platform and never served, so it is no asset: it is named by the asset
 * it maps, and that asset is its whole address.
 */
export interface SourceMapArtifact {
  /** The asset it maps, build-relative like {@link ArtifactFile.path}. */
  bundle: string;
  /** Where the map is, relative to `.base44/source-maps/` — for messages. */
  file: string;
  absolutePath: string;
  size: number;
  /** A full sha256, as for {@link ArtifactFile.digest}. */
  digest: string;
}

/** The app's routes, in its router's order: a tie between two matching routes
 * goes to the first. */
export interface RoutesArtifact {
  pages: PageArtifact[];
  /** The home page's name. */
  home: string | null;
  /** Entity name -> the paths of the parameter-free pages that read it.
   * Absent: not scanned. */
  entityPages?: Record<string, string[]>;
  /** The paths of pages with URL params whose source reads no entity. Absent:
   * not scanned. */
  entityFreePaths?: string[];
}

/** One page of the app, as its router declares it. */
export interface PageArtifact {
  /** The URL path, `:name` for a parameter: `/notes/:id`. */
  path: string;
  /** The app's SEO settings are keyed by it. Two paths that render one
   * component share it. */
  name: string;
  /** The page's file, from the project root: `src/routes/notes.$id.tsx`. */
  file: string;
  /** Proven to render behind a login. Absent: unproven, not public. */
  requiresAuth?: boolean;
  /** How the page loads its record. Absent: it loads none, or that's unknown. */
  binding?: {
    entity: string;
    /** The URL param that selects the record, by `field`. */
    param: string;
    field: string;
    /** Each other URL param -> the field of the same record it renders. */
    extraParams?: Record<string, string>;
  };
  /** URL param -> the fixed values its segment takes. */
  segmentValues?: Record<string, string[]>;
}

export interface CreateVersionProgress {
  onDeclared?: (info: { fileCount: number }) => void;
  onUpload?: (progress: { uploadedFiles: number; totalFiles: number }) => void;
}

const PresignedPutSchema = z.object({
  url: z.string(),
  content_type: z.string(),
  content_length: z.number(),
  checksum_sha256: z.string(),
});

export const DeclareVersionResponseSchema = z
  .object({
    session_id: z.string(),
    uploads: z.array(PresignedPutSchema.extend({ path: z.string() })),
    /** One per source map the platform accepted. Absent from a server that
     * predates them, and from any declaration that carried none. */
    source_map_uploads: z
      .array(PresignedPutSchema.extend({ bundle: z.string() }))
      .optional()
      .default([]),
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
    sourceMapUploads: data.source_map_uploads.map((upload) => ({
      bundle: upload.bundle,
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
