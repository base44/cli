/**
 * esbuild resolver/loader over `@deno/loader` (Deno's own resolver crates,
 * compiled to WASM). A thin in-repo adapter — the published
 * `@deno/esbuild-plugin` is the same idea, but it throws the build away on
 * unresolved *optional* dependencies and reports transpile errors against the
 * importer. We own the glue so we can fix both:
 *
 *   - Optional deps that aren't installed are left external (the import survives
 *     to runtime, where the author's try/catch handles the miss) instead of
 *     failing the bundle. This covers declared optional deps such as axios's
 *     `follow-redirects` -> `debug` and undeclared guarded requires such as
 *     mysql2 -> `cardinal`, matching the old resolver's leniency.
 *   - Transpile/syntax errors are reported with the offending file + position,
 *     not the importing entry.
 *
 * The heavy lifting (npm/jsr/https resolution, multi-version, exports maps) stays
 * in `@deno/loader`.
 */

import { readFileSync, realpathSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MediaType,
  RequestedModuleType,
  ResolutionMode,
  ResolveError,
  Workspace,
} from "@deno/loader";
import type {
  Loader,
  OnLoadArgs,
  OnLoadResult,
  OnResolveArgs,
  OnResolveResult,
  Plugin,
} from "esbuild";
import { logEvent } from "../log.js";
import { USER_NAMESPACE } from "./user-files.js";

// Schemes the loader resolves to; each becomes an esbuild namespace so imports
// inside a loaded module re-enter resolution with the scheme as context.
const NAMESPACES = ["file", "http", "https", "data", "npm", "jsr"];

// We also resolve imports *from* in-memory user files (served by the user-files
// plugin) but never load them — that plugin owns their contents.
const RESOLVE_NAMESPACES = [...NAMESPACES, USER_NAMESPACE];

interface DenoResolverOptions {
  /** Path to the deno.json controlling resolution (we write one per bundle with
   *  `nodeModulesDir: auto` so the loader auto-fetches npm deps under Node). */
  configPath?: string;
}

export function denoResolverPlugin(options: DenoResolverOptions = {}): Plugin {
  return {
    name: "deno-resolver",
    async setup(build) {
      // Security: stop a dependency or data: module from reading host files.
      // Allow file: reads only from where deps live — the global cache, or this
      // build's temp node_modules in "auto" mode — and resolve symlinks first so
      // a crafted link can't point out of those folders.
      const baseDir = options.configPath
        ? path.dirname(options.configPath)
        : undefined;
      const depRoots = [denoCacheRoot(), baseDir]
        .filter((d): d is string => Boolean(d))
        .map(canonicalPath);
      const pathUnderDeps = (absPath: string): boolean => {
        const p = canonicalPath(absPath);
        return depRoots.some((root) => {
          const rel = path.relative(root, p);
          return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
        });
      };

      const workspace = new Workspace({
        platform: "browser",
        nodeConditions: build.initialOptions.conditions,
        configPath: options.configPath,
      });
      // Free both WASM objects when the build settles. They're separate
      // allocations and a missed free() only reclaims via GC, growing the
      // long-lived worker's WASM heap. Loader before workspace; cast since the
      // .d.ts hides the member.
      type DenoLoader = Awaited<ReturnType<Workspace["createLoader"]>>;
      const dispose = (createdLoader?: DenoLoader): void => {
        (createdLoader as unknown as Disposable | undefined)?.[
          Symbol.dispose
        ]?.();
        (workspace as unknown as Disposable)[Symbol.dispose]?.();
      };

      let loader: DenoLoader;
      try {
        // createLoader() is async and can reject; the WASM can also trap with
        // "unreachable" (a Rust panic in the loader). esbuild does NOT run
        // onDispose for a setup() that rejected, so on any failure here we must
        // dispose the Workspace ourselves — otherwise its WASM allocation stays
        // resident in the still-alive worker until GC.
        loader = await workspace.createLoader();
      } catch (err) {
        dispose();
        logEvent(
          "error",
          "base44.bundler.workspace_disposed_on_setup_failure",
          {
            phase: "create_loader",
            wasm_trap: errMessage(err) === "unreachable",
          },
        );
        throw err;
      }
      build.onDispose(() => dispose(loader));

      const externals = (build.initialOptions.external ?? []).map(toRegex);

      const onResolve = async (
        args: OnResolveArgs,
      ): Promise<OnResolveResult | null> => {
        // node: builtins (and configured externals) stay external — workerd's
        // nodejs_compat provides the builtins. require()-of-builtin is claimed
        // earlier by node-builtin-require, so this is the import-kind path.
        if (
          isBuiltin(args.path) ||
          externals.some((re) => re.test(args.path))
        ) {
          return { path: args.path, external: true };
        }

        const mode =
          args.kind === "require-call" || args.kind === "require-resolve"
            ? ResolutionMode.Require
            : ResolutionMode.Import;

        const importer =
          args.namespace === USER_NAMESPACE && baseDir
            ? path.join(baseDir, args.importer)
            : args.importer;

        try {
          const resolved = await loader.resolve(args.path, importer, mode);
          // A non-builtin specifier that still resolves to a builtin (rare) —
          // externalize it like any other node: import.
          if (resolved.startsWith("node:")) {
            return { path: resolved, external: true };
          }
          if (
            resolved.startsWith("file:") &&
            !pathUnderDeps(fileURLToPath(resolved))
          ) {
            return { errors: [fileOutsideCacheError(args.path)] };
          }
          return toEsbuildPath(resolved);
        } catch (err) {
          // DELTA: an uninstalled *optional* dependency is not a build failure.
          // Leave it external so the import survives to runtime (where the
          // author's try/catch turns the missing module into a no-op).
          if (isOptionalDependency(err)) {
            return { path: args.path, external: true };
          }

          // Restore the main/module lookup the loader skips (see
          // resolveEntryFromPackageJson). Before the externalize branch: a
          // resolvable package must be bundled, not left as a broken require().
          const fallbackUrl = resolveEntryFromPackageJson(
            err,
            args.path,
            mode,
            pathUnderDeps,
          );
          if (fallbackUrl) {
            logEvent("info", "base44.bundler.package_entry_fallback", {
              specifier: args.path,
            });
            if (
              fallbackUrl.startsWith("file:") &&
              !pathUnderDeps(fileURLToPath(fallbackUrl))
            ) {
              return { errors: [fileOutsideCacheError(args.path)] };
            }
            return toEsbuildPath(fallbackUrl);
          }

          // Some published packages guard undeclared optional deps with
          // try/catch instead of listing them in package.json. The loader
          // cannot identify those as optional, so preserve the old resolver's
          // runtime fallback only for catchable references originating inside
          // deps. `dynamic-import` is the ESM spelling of the same guarded
          // pattern (`await import("x")`, often tagged webpackIgnore/
          // @vite-ignore — pragmas esbuild does not honor). Static imports must
          // still fail the build.
          //
          // Two shapes of "package not found": a typed ResolveError with
          // ERR_MODULE_NOT_FOUND, or a bare Error reading "Could not find
          // package X from referrer Y" (what @mastra/core -> @ast-grep/napi
          // hits — neither the type nor the code). Match exactly those; other
          // ResolveError codes (exports-map, version conflicts) must keep
          // failing the build with their attributed diagnostic.
          if (
            (isMissingDependency(err) ||
              MISSING_PACKAGE.test(errMessage(err))) &&
            (args.kind === "require-call" ||
              args.kind === "require-resolve" ||
              args.kind === "dynamic-import") &&
            isBareSpecifier(args.path) &&
            args.namespace !== USER_NAMESPACE &&
            pathUnderDeps(importer)
          ) {
            logEvent(
              "info",
              "base44.bundler.undeclared_optional_externalized",
              {
                specifier: args.path,
                referrer_package: packageFromImporter(importer),
              },
            );
            return { path: args.path, external: true };
          }

          // These mean "genuinely not a dependency" — let esbuild report a
          // normal "could not resolve" error with the importer location.
          if (NOT_A_DEP.test(errMessage(err))) {
            return null;
          }

          throw err;
        }
      };

      build.onResolve({ filter: /.*/ }, onResolve);
      for (const namespace of RESOLVE_NAMESPACES) {
        build.onResolve({ filter: /.*/, namespace }, onResolve);
      }

      const onLoad = async (
        args: OnLoadArgs,
      ): Promise<OnLoadResult | undefined> => {
        // Defense in depth if a file: path slips past onResolve.
        if (args.namespace === "file" && !pathUnderDeps(args.path)) {
          return { errors: [fileOutsideCacheError(args.path)] };
        }
        const url = isUrlScheme(args.path)
          ? args.path
          : pathToFileURL(args.path).toString();

        try {
          const res = await loader.load(url, moduleType(args));
          if (res.kind === "external") {
            return undefined;
          }

          return { contents: res.code, loader: mediaToLoader(res.mediaType) };
        } catch (err) {
          // DELTA: the loader transpiles here, so syntax errors surface as a
          // throw. Report a located error against the file being loaded rather
          // than letting esbuild attribute it to the importing entry.
          //
          // A WASM "unreachable" trap (a Rust panic in @deno/loader) also
          // surfaces here as a throw and would otherwise be indistinguishable
          // from a user syntax error — swallowed into a compile_error and never
          // counted as a trap. Emit an observability signal for it (the
          // onResolve path rethrows, so resolve-phase traps already surface as
          // base44.bundler.crash with wasm_trap:true) while keeping the
          // user-facing located-error return unchanged.
          if (errMessage(err) === "unreachable") {
            logEvent("error", "base44.bundler.load_wasm_trap", {
              phase: "load",
            });
          }
          return { errors: [locatedError(err, args.path)] };
        }
      };

      for (const namespace of NAMESPACES) {
        build.onLoad({ filter: /.*/, namespace }, onLoad);
      }
    },
  };
}

function toEsbuildPath(resolved: string): {
  path: string;
  namespace?: string;
} {
  if (resolved.startsWith("file:")) {
    return { path: fileURLToPath(resolved), namespace: "file" };
  }
  for (const scheme of ["http", "https", "data", "npm", "jsr"]) {
    if (resolved.startsWith(`${scheme}:`)) {
      return { path: resolved, namespace: scheme };
    }
  }
  return { path: resolved };
}

function isUrlScheme(p: string): boolean {
  return ["http:", "https:", "data:", "npm:", "jsr:"].some((s) =>
    p.startsWith(s),
  );
}

function moduleType(args: OnLoadArgs): RequestedModuleType {
  switch (args.with?.type) {
    case "text":
      return RequestedModuleType.Text;
    case "bytes":
      return RequestedModuleType.Bytes;
    case "json":
      return RequestedModuleType.Json;
    default:
      return args.path.endsWith(".json")
        ? RequestedModuleType.Json
        : RequestedModuleType.Default;
  }
}

function mediaToLoader(type: MediaType): Loader {
  switch (type) {
    case MediaType.Jsx:
      return "jsx";
    case MediaType.Tsx:
      return "tsx";
    case MediaType.TypeScript:
    case MediaType.Mts:
    case MediaType.Cts:
      return "ts";
    case MediaType.Json:
      return "json";
    case MediaType.Css:
      return "css";
    case MediaType.Wasm:
      return "binary";
    case MediaType.JavaScript:
    case MediaType.Mjs:
    case MediaType.Cjs:
      return "js";
    default:
      return "js";
  }
}

// esbuild passes configured externals to plugins; match them here too.
function toRegex(external: string): RegExp {
  return new RegExp(
    "^" +
      external.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\*/g, ".*") +
      "$",
  );
}

const NOT_A_DEP =
  /not a dependency and not in import map|Relative import path ".*?" not prefixed with/;

// An npm package the loader could not locate at all. Some shapes arrive as a
// typed ResolveError; this family arrives as a bare Error carrying only text.
const MISSING_PACKAGE = /Could not find package .*? from referrer/;

function isBareSpecifier(specifier: string): boolean {
  return (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("#") &&
    !specifier.includes("\\") &&
    !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier)
  );
}

function packageFromImporter(importer: string): string | undefined {
  const parts = canonicalPath(importer).split(path.sep);
  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  const registryIndex = parts.lastIndexOf("registry.npmjs.org");
  const markerIndex = Math.max(nodeModulesIndex, registryIndex);
  if (markerIndex < 0) return undefined;
  const packageIndex = markerIndex + 1;
  const first = parts[packageIndex];
  if (!first) return undefined;
  return first.startsWith("@") && parts[packageIndex + 1]
    ? `${first}/${parts[packageIndex + 1]}`
    : first;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Same wording as the user-files plugin so the message is consistent.
function fileOutsideCacheError(spec: string): { text: string } {
  return {
    text: `Cannot import "${spec}": filesystem imports are not allowed`,
  };
}

// Where the loader caches npm; prod sets DENO_DIR, else Deno's per-OS default.
function denoCacheRoot(): string {
  if (process.env.DENO_DIR) return path.resolve(process.env.DENO_DIR);
  const home = homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Caches", "deno");
    case "win32":
      return path.join(
        process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"),
        "deno",
      );
    default:
      return path.join(
        process.env.XDG_CACHE_HOME ?? path.join(home, ".cache"),
        "deno",
      );
  }
}

// Resolve symlinks before the containment check so a link can't escape an
// allowed root; fall back to the normalized path when it doesn't exist yet.
function canonicalPath(p: string): string {
  try {
    return realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

// `@deno/loader` sets `isOptionalDependency` on ResolveError when an optional
// npm dependency can't be found (ERR_MODULE_NOT_FOUND).
function isOptionalDependency(err: unknown): boolean {
  return err instanceof ResolveError && err.isOptionalDependency === true;
}

function isMissingDependency(err: unknown): boolean {
  return err instanceof ResolveError && err.code === "ERR_MODULE_NOT_FOUND";
}

function locatedError(err: unknown, file: string) {
  const text = errMessage(err);
  // The loader embeds the position in the message (`… :LINE:COL`).
  const m = text.match(/:(\d+):(\d+)\b/);
  return {
    text,
    location: m ? { file, line: Number(m[1]), column: Number(m[2]) } : { file },
  };
}

const ENTRY_EXTENSIONS = [".js", ".mjs", ".cjs", ".json"];
const INDEX_BASENAMES = ["index.js", "index.mjs", "index.cjs", "index.json"];

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Resolve a package.json entry (a module ID) as Node does: literal path, then
 *  appended extensions, then directory index. Returns the file or null. */
function resolveNodeEntry(pkgDir: string, entry: string): string | null {
  const target = path.resolve(pkgDir, entry);
  if (isFile(target)) return target;
  for (const ext of ENTRY_EXTENSIONS) {
    if (isFile(target + ext)) return target + ext;
  }
  for (const index of INDEX_BASENAMES) {
    const candidate = path.join(target, index);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** @deno/loader hardcodes IsCjsResolutionMode::ExplicitTypeCommonJs, so a
 *  package with no `"type"` (CommonJS by Node's default) is treated as ESM;
 *  lacking an `exports` map, its `main` field is skipped and it resolves to a
 *  non-existent `<pkg>/index.js`. The Deno CLI (ImplicitTypeCommonJs) reads
 *  `main` instead. On that ERR_MODULE_NOT_FOUND, read package.json and return
 *  the real entry as a `file://` URL, or null when not this case / unrecoverable. */
function resolveEntryFromPackageJson(
  err: unknown,
  specifier: string,
  mode: ResolutionMode,
  pathUnderDeps: (absPath: string) => boolean,
): string | null {
  if (!(err instanceof ResolveError) || err.code !== "ERR_MODULE_NOT_FOUND") {
    return null;
  }
  const msg = errMessage(err);
  const m = msg.match(/Cannot find module '(file:\/\/\/.+?)'/);
  if (!m) return null;

  let attempted: string;
  try {
    attempted = fileURLToPath(m[1]);
  } catch {
    return null;
  }

  const base = path.basename(attempted);
  if (base !== "index.js" && base !== "index.mjs") return null;

  // Only recover the loader's *synthesized* package-root probe. An explicit
  // `pkg/index.js` (or `./index.js`) import that resolves to this same path was
  // a deliberate request for that file — redirecting it to main/module would
  // silently load a different entry, so let the missing-file error stand.
  if (specifier.endsWith(`/${base}`)) return null;

  const pkgDir = path.dirname(attempted);
  // Fail closed: never touch a package.json (or its entries) outside the cache.
  if (!pathUnderDeps(pkgDir)) return null;
  const pkgJsonPath = path.join(pkgDir, "package.json");

  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    // An `exports` map governs resolution; the loader would have used it, so a
    // miss here is a genuine error — don't override the contract via legacy fields.
    if (pkg.exports != null) return null;

    // Deno's ImplicitTypeCommonJs classifies these type-less packages as CJS and
    // runs `main`, so prefer it for parity. A string `browser` entry wins first
    // (the workerd/browser-targeted build, avoids bundling a Node entry). require()
    // never falls through to `module` — an ESM/browser entry is not require-safe.
    const browser = typeof pkg.browser === "string" ? pkg.browser : undefined;
    const fields =
      mode === ResolutionMode.Require
        ? [browser, pkg.main]
        : [browser, pkg.main, pkg.module];
    for (const entry of fields) {
      if (typeof entry !== "string" || !entry) continue;
      const resolved = resolveNodeEntry(pkgDir, entry);
      if (resolved && pathUnderDeps(resolved)) {
        return pathToFileURL(resolved).toString();
      }
    }
    return null;
  } catch {
    return null;
  }
}
