import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { ConfigInvalidError, InvalidInputError } from "@/core/errors.js";
import { pathExists, readJsonFile } from "@/core/utils/fs.js";

/** Redirect file emitted by @cloudflare/vite-plugin builds, at project root. */
const WRANGLER_REDIRECT_PATH = join(".wrangler", "deploy", "config.json");

const RedirectConfigSchema = z.looseObject({
  configPath: z.string().min(1),
});

// Only the fields a Base44 deploy acts on. Everything else (bindings, worker
// name, ...) rides along in the loose passthrough, neither forwarded nor
// validated.
const WranglerConfigSchema = z.looseObject({
  main: z.string().min(1, "wrangler config is missing a 'main' entry module"),
  no_bundle: z.boolean().optional(),
  rules: z
    .array(z.looseObject({ type: z.string(), globs: z.array(z.string()) }))
    .optional(),
  assets: z
    .looseObject({
      directory: z.string().optional(),
      html_handling: z.string().optional(),
      not_found_handling: z.string().optional(),
      run_worker_first: z.union([z.boolean(), z.array(z.string())]).optional(),
      headers: z.string().optional(),
      redirects: z.string().optional(),
    })
    .optional(),
  compatibility_date: z.string().optional(),
  compatibility_flags: z.array(z.string()).optional(),
  vars: z.record(z.string(), z.unknown()).optional(),
  upload_source_maps: z.boolean().optional(),
});

type WranglerConfig = z.infer<typeof WranglerConfigSchema>;

export interface WranglerModuleRule {
  type: string;
  globs: string[];
}

export interface ResolvedAssetsConfig {
  htmlHandling?: string;
  notFoundHandling?: string;
  runWorkerFirst?: boolean | string[];
  headers?: string;
  redirects?: string;
}

export interface ResolvedWranglerConfig {
  configPath: string;
  /** Module paths — `main` and the rules globs — are relative to this. */
  configDir: string;
  main: string;
  assetsDirectory: string | null;
  assetsConfig: ResolvedAssetsConfig | null;
  compatibilityDate: string | null;
  compatibilityFlags: string[];
  vars: Record<string, unknown>;
  rules: WranglerModuleRule[];
  uploadSourceMaps: boolean;
}

/**
 * Detect a full-stack (Cloudflare Workers) build artifact: the redirect file
 * emitted by @cloudflare/vite-plugin builds.
 *
 * A hand-authored root wrangler config is deliberately not an artifact. Those
 * target wrangler's own bundler, which this path never runs (see the no_bundle
 * gate below), so detecting one would hijack the deploy away from the static
 * upload it was going to do.
 */
export async function detectFullStackArtifact(
  projectRoot: string,
): Promise<string | null> {
  const redirectPath = join(projectRoot, WRANGLER_REDIRECT_PATH);
  return (await pathExists(redirectPath)) ? redirectPath : null;
}

/** Throws when there is no artifact, or when the build still needs bundling. */
export async function resolveWranglerConfig(
  projectRoot: string,
): Promise<ResolvedWranglerConfig> {
  const redirectPath = await detectFullStackArtifact(projectRoot);

  if (!redirectPath) {
    throw new InvalidInputError(
      "No full-stack build artifact found. Expected a .wrangler/deploy/config.json redirect file.",
      {
        hints: [{ message: "Run your framework's build command first" }],
      },
    );
  }

  const configPath = await resolveRedirectedConfigPath(redirectPath);

  const parsed = await readJsonFile(configPath);
  const result = WranglerConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigInvalidError(
      `Invalid wrangler config: ${z.prettifyError(result.error)}`,
      configPath,
    );
  }

  const config = result.data;

  if (config.no_bundle !== true) {
    throw new InvalidInputError(
      "This framework's output requires bundling; not yet supported. Base44 full-stack deploys only support pre-bundled Workers output (no_bundle: true).",
    );
  }

  const configDir = dirname(configPath);
  const assetsDirectory = config.assets?.directory
    ? resolve(configDir, config.assets.directory)
    : null;

  return {
    configPath,
    configDir,
    main: config.main,
    assetsDirectory,
    assetsConfig: config.assets ? toResolvedAssetsConfig(config.assets) : null,
    compatibilityDate: config.compatibility_date ?? null,
    compatibilityFlags: config.compatibility_flags ?? [],
    vars: config.vars ?? {},
    rules: (config.rules ?? []).map((rule) => ({
      type: rule.type,
      globs: rule.globs,
    })),
    uploadSourceMaps: config.upload_source_maps ?? false,
  };
}

async function resolveRedirectedConfigPath(
  redirectPath: string,
): Promise<string> {
  const parsed = await readJsonFile(redirectPath);
  const result = RedirectConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigInvalidError(
      `Invalid deploy redirect file: ${z.prettifyError(result.error)}`,
      redirectPath,
    );
  }

  // Relative to the redirect file's own directory (wrangler semantics).
  const configPath = resolve(dirname(redirectPath), result.data.configPath);
  if (!(await pathExists(configPath))) {
    throw new ConfigInvalidError(
      `Wrangler config referenced by ${redirectPath} does not exist: ${configPath}`,
      redirectPath,
      {
        hints: [{ message: "Rebuild the project to regenerate the artifact" }],
      },
    );
  }
  return configPath;
}

function toResolvedAssetsConfig(
  assets: NonNullable<WranglerConfig["assets"]>,
): ResolvedAssetsConfig {
  return {
    htmlHandling: assets.html_handling,
    notFoundHandling: assets.not_found_handling,
    runWorkerFirst: assets.run_worker_first,
    headers: assets.headers,
    redirects: assets.redirects,
  };
}
