/**
 * Bundle engine. Compiles a prepared worker tree (user files + injected shim +
 * generated entry) into a single workerd ESM module using Deno's own resolver
 * via the `deno-resolver` adapter over `@deno/loader`: `npm:`, `jsr:`, and
 * `https:` specifiers resolve exactly as Deno resolves them (multiple versions,
 * nested deps, correct exports).
 *
 * The loader reads source from a real filesystem, so the tree is materialized
 * into a per-request temp dir, compiled, and removed. `node:` builtins stay
 * external (workerd's `nodejs_compat` provides them) and `cloudflare:*` stays
 * external (provided by the runtime).
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type BuildFailure, build } from "esbuild";
import type { BundleErrorItem } from "./errors.js";
import { denoResolverPlugin } from "./esbuild/deno-resolver.js";
import { nodeBuiltinRequirePlugin } from "./esbuild/node-builtin-require.js";
import { privateDataSourcesVirtualPlugin } from "./esbuild/private-data-sources-virtual.js";
import { runtimeContextVirtualPlugin } from "./esbuild/runtime-context-virtual.js";
import { runtimeVirtualPlugin } from "./esbuild/runtime-virtual.js";
import { USER_NAMESPACE, userFilesPlugin } from "./esbuild/user-files.js";
import type { PreparedWorker } from "./worker-entry.js";

// Whether the build writes a node_modules folder. See installAndCompile for why
// "none" is the fast default and "auto" the fallback.
export type NodeModulesMode = "none" | "auto";

type EngineResult =
  | { ok: true; module: string; warnings: string[] }
  | { ok: false; errors: BundleErrorItem[] };

/**
 * Compile `prepared` to a single ESM module string. Resolution/compile failures
 * (user-attributable) return `{ ok: false }`; infrastructure failures (temp dir,
 * missing output) throw.
 */
export async function bundleToModule(
  prepared: PreparedWorker,
  nodeModulesDir: NodeModulesMode = "none",
): Promise<EngineResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "b44-bundle-"));
  try {
    // Only deno.json (the loader's config) and the materialized node_modules
    // touch disk — user source is served from memory by userFilesPlugin, so a
    // malicious import can't traverse to another build's files.
    await writeFile(
      path.join(dir, "deno.json"),
      JSON.stringify({ nodeModulesDir }),
    );

    let result: Awaited<ReturnType<typeof build>>;
    try {
      result = await build({
        entryPoints: [prepared.entry],
        absWorkingDir: dir,
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        target: "es2022",
        // "node" is active because workerd runs with nodejs_compat: packages
        // like unicorn-magic gate their full API behind the "node" exports
        // condition and ship a stripped default entry, so without it consumers
        // (npm-run-path) import names that don't exist and the bundle fails.
        // Conditions are a set — when a package lists both "workerd" and
        // "node", its own exports-map key order still decides which wins.
        conditions: ["workerd", "worker", "browser", "module", "node"],
        external: ["cloudflare:*"],
        // workerd ESM lacks __dirname/__filename; define rewrites only free refs
        // (npm/Emscripten glue), leaving loader-bound CJS locals intact.
        define: { __dirname: '"/"', __filename: '"/index.js"' },
        minify: true,
        sourcemap: false,
        // Errors are surfaced structurally (return value / BuildFailure); keep
        // esbuild from dumping diagnostics to the service's stderr.
        logLevel: "silent",
        plugins: [
          // CJS require() of a node builtin → static re-export (workerd throws
          // on esbuild's lowered __require). Runs before the Deno resolver.
          nodeBuiltinRequirePlugin(),
          userFilesPlugin(prepared.files, prepared.entry),
          privateDataSourcesVirtualPlugin(),
          runtimeContextVirtualPlugin(),
          runtimeVirtualPlugin(),
          denoResolverPlugin({ configPath: path.join(dir, "deno.json") }),
        ],
      });
    } catch (e) {
      const errors = buildFailureErrors(e, dir);
      if (errors) return { ok: false, errors };
      throw e;
    }

    const outputs = result.outputFiles ?? [];
    if (outputs.length !== 1) {
      // bundle:true with code-splitting off yields exactly one module; anything
      // else means a plugin claimed the entry or emitted extra files — a bug.
      throw new Error(
        `expected single-module output, got ${outputs.length} file(s)`,
      );
    }

    return {
      ok: true,
      module: outputs[0].text,
      warnings: result.warnings.map((w) => w.text),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Flatten an esbuild `BuildFailure` into compile diagnostics, rewriting the
 *  temp-dir-absolute file paths back to the paths the user typed. Returns null
 *  if `e` is not an esbuild failure (so the caller rethrows it). */
function buildFailureErrors(e: unknown, dir: string): BundleErrorItem[] | null {
  if (typeof e !== "object" || e === null || !("errors" in e)) return null;
  const raw = (e as BuildFailure).errors;
  if (!Array.isArray(raw)) return null;
  return raw.map((m) => normalizeError(m, dir));
}

function normalizeError(
  m: { text?: string; location?: unknown },
  dir: string,
): BundleErrorItem {
  const message = m.text ?? "bundle error";
  const item: BundleErrorItem = { message };

  // The Deno loader transpiles before esbuild sees the source, so a syntax
  // error's real location lives in the message text
  // (`… at file:///<abs>/main.ts:LINE:COL`) while esbuild's structured
  // `location` points at the importing entry. Prefer the embedded one so the
  // diagnostic points at the user's file.
  const embedded = message.match(/file:\/\/(\/[^\s:]+):(\d+):(\d+)/);
  if (embedded) {
    item.file = relativizeFile(embedded[1], dir);
    item.line = Number(embedded[2]);
    item.column = Number(embedded[3]);
  }

  const loc = m.location as {
    file?: string;
    line?: number;
    column?: number;
    lineText?: string;
    suggestion?: string;
  } | null;
  if (item.file === undefined && loc?.file) {
    item.file = relativizeFile(loc.file, dir);
  }
  if (item.line === undefined && typeof loc?.line === "number") {
    item.line = loc.line;
  }
  if (item.column === undefined && typeof loc?.column === "number") {
    item.column = loc.column;
  }
  if (loc?.lineText) item.lineText = loc.lineText;
  if (loc?.suggestion) item.suggestion = loc.suggestion;
  return item;
}

/** Normalize the file in a diagnostic to the path the user typed. User files are
 *  virtual keys esbuild prefixes with the namespace (`user:main.ts`); deps are
 *  temp-dir-absolute (`<dir>/node_modules/foo/…`). Strip either prefix. */
function relativizeFile(file: string, dir: string): string {
  if (file.startsWith(`${USER_NAMESPACE}:`)) {
    return file.slice(USER_NAMESPACE.length + 1);
  }
  const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}
