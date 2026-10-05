import { createHash } from "node:crypto";
import { relative } from "node:path";
import type {
  AppFunctionInput,
  ShardBuildFailure,
  ShardPolicy,
} from "@base44/functions-compiler";
import pMap from "p-map";
import { DependencyNotFoundError, InvalidInputError } from "@/core/errors.js";
import { readAllFunctions } from "@/core/resources/function/config.js";
import type { BackendFunction } from "@/core/resources/function/schema.js";
import { readTextFile } from "@/core/utils/fs.js";
import type { BackendBundleArtifact } from "@/core/version/schema.js";

type Compiler = typeof import("@base44/functions-compiler");

/**
 * apper's production defaults with Worker sharding off: one shard holding every
 * function, halved only when its module is over the compressed cap. Fixed here
 * rather than asked of the platform — they are the same for every app.
 */
const SHARD_POLICY: ShardPolicy = {
  shardSize: 100,
  globalShardSize: 100,
  maxShards: 1,
  gzipCapBytes: 9_500_000,
};

/** Both off, the production baseline. Each one changes the emitted bytes. */
const COMPILE_MODES = { runtimeSecrets: false, postResponseTelemetry: false };

/**
 * A real `dependency`, external to the bundle and imported here only: it pulls
 * in esbuild and @deno/loader, which the standalone binary cannot carry.
 */
async function loadCompiler(): Promise<Compiler> {
  try {
    return await import("@base44/functions-compiler");
  } catch (error) {
    throw new DependencyNotFoundError(
      "Backend functions cannot be compiled by this installation of the CLI.",
      {
        hints: [{ message: "Install the CLI from npm: npm install -g base44" }],
        cause: error instanceof Error ? error : undefined,
      },
    );
  }
}

/** Project-relative and forward-slashed: the path the platform stores, and so
 * the one a multi-file function compiles under. */
function projectPath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(/[/\\]/).join("/");
}

async function compilerInput(
  compiler: Compiler,
  root: string,
  fn: BackendFunction,
): Promise<AppFunctionInput> {
  const backendFiles: Record<string, string> = {};
  for (const filePath of fn.filePaths) {
    backendFiles[projectPath(root, filePath)] = await readTextFile(filePath);
  }
  const { entry, files } = await compiler.cfwBundleInput(
    projectPath(root, fn.entryPath),
    await readTextFile(fn.entryPath),
    backendFiles,
  );
  return { name: fn.name, entry, files };
}

function describeFailure(failure: ShardBuildFailure): string {
  const where = failure.function ? `${failure.function}: ` : "";
  const errors = (failure.errors ?? []).map((e) =>
    e.file ? `${e.file}:${e.line ?? 0} ${e.message}` : e.message,
  );
  return [`${where}${failure.message}`, ...errors].join("\n  ");
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Every backend function, compiled into the Worker shards the platform deploys
 * as they are. A function that fails to compile fails the whole set: a version
 * without it would describe the app without it, and its deploy would remove it.
 */
export async function compileBackendBundles(
  root: string,
  functionsDir: string,
): Promise<BackendBundleArtifact[]> {
  const functions = await readAllFunctions(functionsDir);
  if (functions.length === 0) {
    return [];
  }

  const compiler = await loadCompiler();
  // By name: one shard compiles in the order it is given, and that order is
  // in the bytes — a filesystem walk's order would mint versions for nothing.
  const sorted = [...functions].sort((a, b) => (a.name < b.name ? -1 : 1));
  const inputs = await pMap(sorted, (fn) => compilerInput(compiler, root, fn), {
    concurrency: 8,
  });
  const entries = new Map(inputs.map((input) => [input.name, input.entry]));

  const built = await compiler.compileFunctionShards(
    inputs,
    SHARD_POLICY,
    COMPILE_MODES,
  );
  if (!built.ok) {
    throw new InvalidInputError(
      `Backend functions failed to compile (${built.failures.length} error${built.failures.length === 1 ? "" : "s"}).`,
      { details: built.failures.map(describeFailure) },
    );
  }

  return built.shards.map((shard) => {
    const module = new TextEncoder().encode(shard.module);
    return {
      module,
      size: module.byteLength,
      digest: sha256(module),
      functions: shard.functions.map((name) => ({
        name,
        entry: entries.get(name)!,
      })),
      ...COMPILE_MODES,
      // Every module this compiler emits carries its static-egress wrapper,
      // which is what the platform checks before binding a static egress.
      staticEgressArtifact: compiler.STATIC_EGRESS_ARTIFACT_MARKER,
    };
  });
}
